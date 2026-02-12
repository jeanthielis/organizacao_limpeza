import { createApp, ref, computed, onMounted, watch, nextTick } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
import { db, auth, collection, addDoc, getDocs, doc, deleteDoc, query, setDoc, where, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase.js'

createApp({
    setup() {
        // === ESTADO GERAL ===
        const user = ref(null);
        const authMode = ref('login');
        const authForm = ref({ email: '', password: '' });
        const authError = ref('');
        const loading = ref(false);
        const isDarkMode = ref(localStorage.getItem('darkMode') === 'true');
        
        const currentView = ref('inspection');
        const menuItems = [
            { id: 'inspection', label: 'Inspeção', icon: 'fas fa-tasks' },
            { id: 'reports', label: 'Relatórios', icon: 'fas fa-chart-pie' },
            { id: 'admin', label: 'Admin', icon: 'fas fa-cogs' },
        ];

        // === INSPEÇÃO ===
        const currentTeam = ref('Equipe 1');
        const currentDate = ref(new Date().toISOString().split('T')[0]);
        const points = ref([]); 
        const loadingPoints = ref(false);
        const saving = ref(false);
        const meta = 93;
        const inspectionObservation = ref(''); 

        // === ADMIN ===
        const pointsConfig = ref([]); 
        const newPointName = ref('');

        // === RELATÓRIOS ===
        const reportType = ref('monthly'); 
        const reportMonth = ref(new Date().toISOString().slice(0, 7));
        const reportYear = ref(new Date().getFullYear());
        const dailyDate = ref(new Date().toISOString().split('T')[0]);
        // Removemos dailyTeam pois agora mostra todas
        
        const loadingReports = ref(false);
        const teamStats = ref([]);
        const dailyDataList = ref([]); // Mudei de dailyData (objeto) para lista
        let chartInstance = null;

        // === COMPUTED ===
        const progress = computed(() => {
            if (points.value.length === 0) return 0;
            const checkedCount = points.value.filter(p => p.checked).length;
            return (checkedCount / points.value.length) * 100;
        });

        const allSelected = computed(() => points.value.length > 0 && points.value.every(p => p.checked));

        // === WATCHERS ===
        watch(isDarkMode, (val) => {
            if (val) document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
            localStorage.setItem('darkMode', val);
            if(currentView.value === 'reports' && reportType.value !== 'daily') {
                setTimeout(() => renderChart(reportType.value === 'annual' ? 'line' : 'bar'), 300);
            }
        }, { immediate: true });

        watch([currentView, reportType, reportMonth, reportYear, dailyDate], () => {
            if (currentView.value === 'reports') loadReports();
        });

        watch([currentTeam, currentDate], () => initializeChecklist());
        watch(pointsConfig, () => { if (currentView.value === 'inspection') initializeChecklist(); });

        // === INICIALIZAÇÃO ===
        onMounted(() => {
            if (auth) {
                onAuthStateChanged(auth, (u) => {
                    user.value = u;
                    if (u) loadMasterPoints();
                });
            }
        });

        // === FUNÇÕES ===
        const toggleDarkMode = () => isDarkMode.value = !isDarkMode.value;
        const toggleAllPoints = () => {
            const targetState = !allSelected.value;
            points.value.forEach(p => p.checked = targetState);
        };
        const togglePoint = (point) => point.checked = !point.checked;

        const handleAuth = async () => {
            loading.value = true;
            authError.value = '';
            try {
                if (authMode.value === 'login') await signInWithEmailAndPassword(auth, authForm.value.email, authForm.value.password);
                else await createUserWithEmailAndPassword(auth, authForm.value.email, authForm.value.password);
            } catch (e) { authError.value = "Erro: " + e.message; } 
            finally { loading.value = false; }
        };
        const logout = () => signOut(auth);

        // === LÓGICA DE DADOS ===
        const loadMasterPoints = async () => {
            if (!db || !user.value) return;
            loadingPoints.value = true;
            try {
                const q = query(collection(db, "config_pontos"));
                const querySnapshot = await getDocs(q);
                let loadedPoints = [];
                querySnapshot.forEach((doc) => loadedPoints.push({ id: doc.id, ...doc.data() }));
                if (loadedPoints.length === 0) {
                    loadedPoints = [{ name: 'Sala de Tonalidade L4' }, { name: 'Área da Qualitron L4' }].map(p => ({ ...p, id: 'temp_' + Math.random() })); 
                }
                pointsConfig.value = loadedPoints;
                initializeChecklist();
            } catch (e) { console.error(e); } finally { loadingPoints.value = false; }
        };

        const initializeChecklist = async () => {
            const basePoints = pointsConfig.value.map(p => ({ 
                id: p.id, name: p.name, checked: false, obs: '', showObs: false 
            }));
            inspectionObservation.value = '';
            try {
                const docId = `${currentTeam.value}_${currentDate.value}`;
                const localSaved = localStorage.getItem(`cp_temp_${docId}`);
                if (localSaved) {
                    const savedData = JSON.parse(localSaved);
                    basePoints.forEach(p => {
                        const found = savedData.points.find(sp => sp.name === p.name);
                        if (found) {
                            p.checked = found.checked;
                            p.obs = found.obs || '';
                            if(p.obs) p.showObs = true;
                        }
                    });
                    if(savedData.observation) inspectionObservation.value = savedData.observation;
                }
            } catch (e) { console.error(e) }
            points.value = basePoints;
        };

        const saveInspection = async () => {
            if (!db) return alert("Banco desconectado");
            saving.value = true;
            try {
                const docId = `${currentTeam.value}_${currentDate.value}`;
                const payload = {
                    team: currentTeam.value, date: currentDate.value,
                    points: points.value.map(p => ({ name: p.name, checked: p.checked, obs: p.obs })),
                    score: progress.value, user: user.value.email, updatedAt: new Date(),
                    observation: inspectionObservation.value
                };
                localStorage.setItem(`cp_temp_${docId}`, JSON.stringify(payload));
                await setDoc(doc(db, "inspections", docId), payload);
                alert(`Salvo com sucesso!`);
            } catch (e) { alert("Erro: " + e.message); } finally { saving.value = false; }
        };

        // === RELATÓRIOS ===
        const loadReports = async () => {
            if (!db || !user.value) return;
            loadingReports.value = true;
            teamStats.value = [];
            dailyDataList.value = [];

            try {
                // 1. MENSAL (Com Ranking Denso)
                if (reportType.value === 'monthly') {
                    const startStr = reportMonth.value + "-01";
                    const endStr = reportMonth.value + "-31";
                    const q = query(collection(db, "inspections"), where("date", ">=", startStr), where("date", "<=", endStr));
                    const snapshot = await getDocs(q);
                    
                    const stats = {};
                    snapshot.forEach(doc => {
                        const d = doc.data();
                        const score = parseFloat(d.score) || 0;
                        if (!stats[d.team]) stats[d.team] = { total: 0, count: 0, name: d.team };
                        stats[d.team].total += score;
                        stats[d.team].count++;
                    });
                    
                    // Ordena por média
                    let sortedStats = Object.values(stats).map(s => ({
                        name: s.name, average: parseFloat((s.total / s.count).toFixed(1)), count: s.count
                    })).sort((a, b) => b.average - a.average);

                    // ALGORITMO DE RANKING DENSO (EMPATES)
                    let currentRank = 1;
                    for (let i = 0; i < sortedStats.length; i++) {
                        // Se não for o primeiro e a média for menor que o anterior, aumenta o rank
                        // Se for igual, mantém o mesmo rank (empate)
                        if (i > 0 && sortedStats[i].average < sortedStats[i-1].average) {
                            currentRank++; 
                        }
                        sortedStats[i].rank = currentRank;
                    }

                    teamStats.value = sortedStats;
                    
                    loadingReports.value = false;
                    setTimeout(() => renderChart('bar'), 100);
                } 
                // 2. ANUAL
                else if (reportType.value === 'annual') {
                    const startStr = reportYear.value + "-01-01";
                    const endStr = reportYear.value + "-12-31";
                    const q = query(collection(db, "inspections"), where("date", ">=", startStr), where("date", "<=", endStr));
                    const snapshot = await getDocs(q);
                    const rawData = [];
                    snapshot.forEach(doc => rawData.push(doc.data()));
                    const teamsData = {};
                    ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'].forEach(t => teamsData[t] = Array(12).fill({ total: 0, count: 0 }));
                    rawData.forEach(d => {
                        if (teamsData[d.team]) {
                            const month = parseInt(d.date.split('-')[1]) - 1; 
                            teamsData[d.team][month] = { total: teamsData[d.team][month].total + (parseFloat(d.score)||0), count: teamsData[d.team][month].count + 1 };
                        }
                    });
                    teamStats.value = Object.keys(teamsData).map(t => ({ name: t, data: teamsData[t].map(m => m.count > 0 ? parseFloat((m.total / m.count).toFixed(1)) : null) }));
                    loadingReports.value = false;
                    setTimeout(() => renderChart('line'), 100);
                }
                // 3. DIÁRIO (Todas as Equipes)
                else if (reportType.value === 'daily') {
                    // Busca apenas pela DATA, sem filtro de equipe
                    const q = query(collection(db, "inspections"), where("date", "==", dailyDate.value));
                    const snapshot = await getDocs(q);
                    
                    let list = [];
                    snapshot.forEach(doc => list.push(doc.data()));
                    
                    // Ordena por nome da equipe
                    list.sort((a, b) => a.team.localeCompare(b.team));
                    
                    dailyDataList.value = list;
                    loadingReports.value = false;
                }

            } catch (e) { console.error(e); loadingReports.value = false; }
        };

        const renderChart = (type) => {
            const ctx = document.getElementById('mainChart');
            if (!ctx) return;
            const existingChart = window.Chart.getChart(ctx);
            if (existingChart) existingChart.destroy();

            const textColor = isDarkMode.value ? '#94a3b8' : '#64748b';
            const ChartConstructor = window.Chart;

            if (type === 'bar') {
                const labels = ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'];
                const data = labels.map(t => { const s = teamStats.value.find(x => x.name === t); return s ? s.average : 0; });
                const colors = data.map(v => v >= meta ? '#10b981' : '#ef4444');
                
                new ChartConstructor(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: 'Média (%)', data: data, backgroundColor: colors, borderRadius: 5, order: 2 },
                            { type: 'line', label: `Meta: ${meta}%`, data: [meta,meta,meta,meta], borderColor: isDarkMode.value?'#fff':'#333', borderDash:[5,5], borderWidth: 3, pointRadius: 0, order: 1 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks:{color:textColor} }, x:{ticks:{color:textColor}} }, plugins:{ legend:{ display: true, position: 'bottom', labels:{color:textColor}} } }
                });
            } else if (type === 'line') {
                const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                const datasets = teamStats.value.map((t, i) => ({
                    label: t.name, data: t.data, borderColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'][i], tension: 0.3
                }));
                new ChartConstructor(ctx, {
                    type: 'line', data: { labels: months, datasets: datasets },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 150, ticks:{color:textColor} }, x:{ticks:{color:textColor}} }, plugins:{ legend:{ position: 'bottom', labels:{color:textColor}} } }
                });
            }
        };

        const generatePDF = async () => {
            const element = document.getElementById('reportContent');
            if(!element) return;
            try {
                // Aumentei Scale para 4 (Melhor Qualidade)
                const canvas = await window.html2canvas(element, { scale: 4, backgroundColor: isDarkMode.value ? '#1e293b' : '#ffffff' });
                const imgData = canvas.toDataURL('image/png');
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                pdf.addImage(imgData, 'PNG', 0, 10, pdfWidth, pdfHeight);
                pdf.save(`Relatorio_${reportType.value}.pdf`);
            } catch(e) { console.error(e); alert("Erro ao gerar PDF."); }
        };

        const takeScreenshot = async () => {
            const element = document.getElementById('reportContent');
            if(!element) return;
            try {
                // Aumentei Scale para 4 (Melhor Qualidade)
                const canvas = await window.html2canvas(element, { scale: 4, backgroundColor: isDarkMode.value ? '#1e293b' : '#ffffff' });
                const link = document.createElement('a');
                link.download = `Print_${reportType.value}.png`;
                link.href = canvas.toDataURL();
                link.click();
            } catch(e) { console.error(e); alert("Erro ao gerar Print."); }
        };

        const addPoint = async () => {
            if (!newPointName.value.trim()) return;
            try { const r = await addDoc(collection(db, "config_pontos"), { name: newPointName.value }); pointsConfig.value.push({id:r.id, name:newPointName.value}); newPointName.value=''; } catch(e){}
        };
        const deletePoint = async (id) => { if(confirm('Remover?')) { await deleteDoc(doc(db,"config_pontos",id)); pointsConfig.value=pointsConfig.value.filter(p=>p.id!==id); }};

        return {
            user, authMode, authForm, authError, loading, handleAuth, logout,
            currentView, menuItems, currentTeam, currentDate, points, progress, meta, loadingPoints, saving, 
            pointsConfig, newPointName, addPoint, deletePoint, 
            isDarkMode, toggleDarkMode, toggleAllPoints, allSelected, inspectionObservation,
            reportType, reportMonth, reportYear, dailyDate, loadingReports, teamStats, dailyDataList,
            generatePDF, takeScreenshot, saveInspection, togglePoint
        };
    }
}).mount('#app')
