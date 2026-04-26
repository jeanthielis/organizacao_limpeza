import { createApp, ref, computed, onMounted, watch, nextTick } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
import { db, auth, collection, addDoc, getDocs, doc, deleteDoc, query, setDoc, where, orderBy, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, getDoc } from './firebase.js'

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
            { id: 'history', label: 'Histórico', icon: 'fas fa-history' },
            { id: 'reports', label: 'Relatórios', icon: 'fas fa-chart-pie' },
            { id: 'admin', label: 'Admin', icon: 'fas fa-cogs' },
        ];

        // === INSPEÇÃO ===
        const currentTeam = ref('Equipe 1');
        const currentDate = ref(new Date().toISOString().split('T')[0]);
        const points = ref([]); 
        const loadingPoints = ref(false);
        const saving = ref(false);
        const meta = ref(93); 
        const inspectionObservation = ref(''); 

        // === HISTÓRICO ===
        const historyList = ref([]);
        const loadingHistory = ref(false);
        const historyMonth = ref(new Date().toISOString().slice(0, 7));

        // === ADMIN ===
        const pointsConfig = ref([]); 
        const newPointName = ref('');

        // === RELATÓRIOS ===
        const reportType = ref('monthly'); 
        const reportMonth = ref(new Date().toISOString().slice(0, 7));
        const reportYear = ref(new Date().getFullYear());
        const dailyDate = ref(new Date().toISOString().split('T')[0]);
        const loadingReports = ref(false);
        const teamStats = ref([]);
        const dailyDataList = ref([]);
        // NOVO: Estado para os ofensores
        const topOffenders = ref([]);

        // === ESCALA 12x36 ===
        const teamsSchedule = ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'];
        const pendingChecks = ref([]);
        const loadingPending = ref(false);
        
        // === HISTÓRICO DE PENDÊNCIAS ===
        const pendingHistory = ref([]);
        const loadingPendingHistory = ref(false);
        const selectedTeamFilter = ref('Todas');
        const selectedDateRange = ref('30');

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
                setTimeout(() => {
                    renderChart(reportType.value === 'annual' ? 'line' : 'bar');
                    renderOffendersChart();
                }, 300);
            }
        }, { immediate: true });

        watch([currentView, reportType, reportMonth, reportYear, dailyDate, historyMonth], () => {
            if (currentView.value === 'reports') loadReports();
            if (currentView.value === 'history') loadHistory();
        });

        // Watcher para criar gráficos quando dados carregar
        watch(dailyDataList, (newData) => {
            if (reportType.value === 'daily' && newData && newData.length > 0) {
                nextTick(() => {
                    newData.forEach((report, idx) => {
                        createDailyChart('pieChart' + idx, report.score, meta.value);
                    });
                });
            }
        });

        watch([currentTeam, currentDate], () => initializeChecklist());
        watch(pointsConfig, () => { if (currentView.value === 'inspection') initializeChecklist(); });

        // === INICIALIZAÇÃO ===
        onMounted(() => {
            if (auth) {
                onAuthStateChanged(auth, (u) => {
                    user.value = u;
                    if (u) {
                        loadMasterPoints();
                        loadMeta();
                        loadPendingChecks();
                        loadPendingHistory();
                        // Atualiza pendências a cada 5 minutos
                        setInterval(() => loadPendingChecks(), 5 * 60 * 1000);
                        // Atualiza histórico a cada 10 minutos
                        setInterval(() => loadPendingHistory(), 10 * 60 * 1000);
                    }
                });
            }
        });

        watch([selectedTeamFilter, selectedDateRange], () => {
            loadPendingHistory();
        });

        // === FUNÇÕES GERAIS ===
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

        const loadMeta = async () => {
            if (!db) return;
            try {
                const docRef = doc(db, "config_geral", "meta_padrao");
                const snap = await getDoc(docRef);
                if (snap.exists()) meta.value = snap.data().valor;
            } catch (e) { console.log("Usando meta padrão 93%"); }
        };

        const saveMeta = async () => {
            if (!db) return;
            try {
                await setDoc(doc(db, "config_geral", "meta_padrao"), { valor: meta.value });
                alert("Nova meta definida com sucesso!");
                if (currentView.value === 'reports' && reportType.value !== 'daily') {
                   renderChart(reportType.value === 'annual' ? 'line' : 'bar');
                   renderOffendersChart();
                }
            } catch (e) { alert("Erro ao salvar meta: " + e.message); }
        };

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

        const isLoading = ref(false);  // Flag para evitar salvar durante carregamento

        const initializeChecklist = async () => {
            isLoading.value = true;  // ✅ Ativa flag de carregamento
            try {
                const docId = `${currentTeam.value}_${currentDate.value}`;
                const docRef = doc(db, "inspections", docId);
                let sourceData = null;
                
                // Prioridade 1: Buscar no Firebase
                try {
                   const docSnap = await getDoc(docRef);
                   if (docSnap.exists()) sourceData = docSnap.data();
                } catch(err) { console.log("Erro ao buscar inspeção:", err); }

                // Prioridade 2: Se não encontrar no Firebase, buscar localStorage
                if (!sourceData) {
                    const localSaved = localStorage.getItem(`cp_temp_${docId}`);
                    if (localSaved) sourceData = JSON.parse(localSaved);
                }

                // Se encontrou dados salvos, usar eles! Senão, criar novo com false
                if (sourceData && sourceData.points) {
                    // ✅ RESTAURAR dados existentes
                    points.value = sourceData.points.map(p => ({
                        id: p.id || 'temp_' + Math.random(),
                        name: p.name,
                        checked: p.checked === true, // Garantir boolean
                        obs: p.obs || '',
                        showObs: !!(p.obs)
                    }));
                    if(sourceData.observation) inspectionObservation.value = sourceData.observation;
                } else {
                    // 🆕 CRIAR novo com todos false
                    const basePoints = pointsConfig.value.map(p => ({ 
                        id: p.id, name: p.name, checked: false, obs: '', showObs: false 
                    }));
                    points.value = basePoints;
                    inspectionObservation.value = '';
                }
            } catch (e) { console.error('Erro em initializeChecklist:', e) }
            finally {
                isLoading.value = false;  // ✅ Desativa flag após carregar
            }
        };

        const saveInspection = async () => {
            // 🚫 Não salvar enquanto está carregando dados
            if (isLoading.value) {
                console.log("Ainda carregando, não salvando...");
                return;
            }
            
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

        const loadHistory = async () => {
            if (!db || !user.value) return;
            loadingHistory.value = true;
            historyList.value = [];
            try {
                const startStr = historyMonth.value + "-01";
                const endStr = historyMonth.value + "-31";
                const q = query(collection(db, "inspections"), where("date", ">=", startStr), where("date", "<=", endStr));
                const snapshot = await getDocs(q);
                
                let list = [];
                snapshot.forEach(doc => list.push(doc.data()));
                
                list.sort((a, b) => {
                    if (a.date !== b.date) return b.date.localeCompare(a.date);
                    return a.team.localeCompare(b.team);
                });
                
                historyList.value = list;
            } catch (e) { console.error(e); } finally { loadingHistory.value = false; }
        };

        const editFromHistory = (item) => {
            currentTeam.value = item.team;
            currentDate.value = item.date;
            currentView.value = 'inspection';
        };

        const deleteInspection = async (item) => {
            if(!confirm(`Tem certeza que deseja excluir a inspeção da ${item.team} do dia ${item.date.split('-').reverse().join('/')}?`)) return;
            try {
                const docId = `${item.team}_${item.date}`;
                await deleteDoc(doc(db, "inspections", docId));
                historyList.value = historyList.value.filter(i => !(i.team === item.team && i.date === item.date));
                localStorage.removeItem(`cp_temp_${docId}`);
                alert("Registro excluído com sucesso.");
            } catch (e) {
                console.error(e);
                alert("Erro ao excluir: " + e.message);
            }
        };

        // === RELATÓRIOS ===
        const loadReports = async () => {
            if (!db || !user.value) return;
            loadingReports.value = true;
            teamStats.value = [];
            dailyDataList.value = [];
            topOffenders.value = []; // Reseta ofensores

            try {
                // Objeto auxiliar para contar falhas
                let failures = {};

                if (reportType.value === 'monthly') {
                    const startStr = reportMonth.value + "-01";
                    const endStr = reportMonth.value + "-31";
                    const q = query(collection(db, "inspections"), where("date", ">=", startStr), where("date", "<=", endStr));
                    const snapshot = await getDocs(q);
                    
                    const stats = {};
                    const daysWorkedByTeam = {}; // Contar dias esperados por equipe
                    
                    // Primeiro: Contar quantos dias cada equipe deveria ter trabalhado
                    const [year, month] = reportMonth.value.split('-');
                    const daysInMonth = new Date(year, month, 0).getDate(); // Último dia do mês
                    
                    for (let day = 1; day <= daysInMonth; day++) {
                        const dateStr = reportMonth.value + "-" + String(day).padStart(2, '0');
                        const periods = getSchedulePeriods(dateStr);
                        periods.forEach(p => {
                            if (!daysWorkedByTeam[p.team]) daysWorkedByTeam[p.team] = 0;
                            daysWorkedByTeam[p.team]++;
                        });
                    }
                    
                    snapshot.forEach(doc => {
                        const d = doc.data();
                        
                        // Lógica de Estatísticas da Equipe
                        const score = parseFloat(d.score) || 0;
                        if (!stats[d.team]) stats[d.team] = { total: 0, count: 0, name: d.team };
                        stats[d.team].total += score;
                        stats[d.team].count++;

                        // NOVO: Lógica de Top Ofensores
                        if (d.points) {
                            d.points.forEach(p => {
                                if (!p.checked) { // Se o ponto não foi marcado (reprovado)
                                    failures[p.name] = (failures[p.name] || 0) + 1;
                                }
                            });
                        }
                    });
                    
                    // Calcular média simples dos scores
                    let sortedStats = Object.values(stats).map(s => {
                        const average = parseFloat((s.total / s.count).toFixed(1));
                        
                        return {
                            name: s.name,
                            average: average,
                            count: s.count
                        };
                    }).sort((a, b) => b.average - a.average);

                    let currentRank = 1;
                    for (let i = 0; i < sortedStats.length; i++) {
                        if (i > 0 && sortedStats[i].average < sortedStats[i-1].average) currentRank++; 
                        sortedStats[i].rank = currentRank;
                    }
                    teamStats.value = sortedStats;

                    // Processa Top Ofensores
                    topOffenders.value = Object.entries(failures)
                        .map(([name, count]) => ({ name, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5); // Pega só os top 5

                    loadingReports.value = false;
                    setTimeout(() => {
                        renderChart('bar');
                        renderOffendersChart(); // Renderiza o novo gráfico
                    }, 100);
                } 
                else if (reportType.value === 'annual') {
                    const startStr = reportYear.value + "-01-01";
                    const endStr = reportYear.value + "-12-31";
                    const q = query(collection(db, "inspections"), where("date", ">=", startStr), where("date", "<=", endStr));
                    const snapshot = await getDocs(q);
                    const rawData = [];
                    
                    snapshot.forEach(doc => {
                        const d = doc.data();
                        rawData.push(d);

                        // Lógica de Top Ofensores (Anual)
                        if (d.points) {
                            d.points.forEach(p => {
                                if (!p.checked) failures[p.name] = (failures[p.name] || 0) + 1;
                            });
                        }
                    });

                    const teamsData = {};
                    ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'].forEach(t => teamsData[t] = Array(12).fill({ total: 0, count: 0 }));
                    rawData.forEach(d => {
                        if (teamsData[d.team]) {
                            const month = parseInt(d.date.split('-')[1]) - 1; 
                            teamsData[d.team][month] = { total: teamsData[d.team][month].total + (parseFloat(d.score)||0), count: teamsData[d.team][month].count + 1 };
                        }
                    });
                    teamStats.value = Object.keys(teamsData).map(t => ({ name: t, data: teamsData[t].map(m => m.count > 0 ? parseFloat((m.total / m.count).toFixed(1)) : null) }));
                    
                    // Processa Top Ofensores
                    topOffenders.value = Object.entries(failures)
                        .map(([name, count]) => ({ name, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5);

                    loadingReports.value = false;
                    setTimeout(() => {
                        renderChart('line');
                        renderOffendersChart();
                    }, 100);
                }
                else if (reportType.value === 'daily') {
                    const q = query(collection(db, "inspections"), where("date", "==", dailyDate.value));
                    const snapshot = await getDocs(q);
                    let list = [];
                    
                    // Obter equipes que trabalhavam naquele dia
                    const teamsWorkingToday = getSchedulePeriods(dailyDate.value).map(p => p.team);
                    
                    snapshot.forEach(doc => {
                        // FILTRO: Incluir apenas se a equipe trabalhava naquele dia
                        if (teamsWorkingToday.includes(doc.data().team)) {
                            list.push(doc.data());
                        }
                    });
                    
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
            const currentMeta = meta.value;

            if (type === 'bar') {
                const labels = ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'];
                const data = labels.map(t => { const s = teamStats.value.find(x => x.name === t); return s ? s.average : 0; });
                const colors = data.map(v => v >= currentMeta ? '#10b981' : '#ef4444');
                
                new ChartConstructor(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: 'Média (%)', data: data, backgroundColor: colors, borderRadius: 5, order: 2 },
                            { type: 'line', label: `Meta: ${currentMeta}%`, data: [currentMeta,currentMeta,currentMeta,currentMeta], borderColor: isDarkMode.value?'#fff':'#333', borderDash:[5,5], borderWidth: 3, pointRadius: 0, order: 1 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 150, ticks:{color:textColor} }, x:{ticks:{color:textColor}} }, plugins:{ legend:{ display: true, position: 'bottom', labels:{color:textColor}} } }
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

        // === NOVA FUNÇÃO: RENDERIZA GRÁFICO DE OFENSORES ===
        const renderOffendersChart = () => {
            const ctx = document.getElementById('offendersChart');
            if (!ctx) return;
            
            // Destroi gráfico anterior se existir
            const existingChart = window.Chart.getChart(ctx);
            if (existingChart) existingChart.destroy();

            // Se não houver dados, não renderiza nada
            if(topOffenders.value.length === 0) return;

            const textColor = isDarkMode.value ? '#94a3b8' : '#64748b';
            const ChartConstructor = window.Chart;

            new ChartConstructor(ctx, {
                type: 'bar',
                data: {
                    labels: topOffenders.value.map(i => i.name),
                    datasets: [{
                        label: 'Qtd Reprovações',
                        data: topOffenders.value.map(i => i.count),
                        backgroundColor: '#ef4444', // Vermelho para indicar alerta
                        borderRadius: 4,
                        indexAxis: 'y', // Faz o gráfico ser horizontal
                    }]
                },
                options: {
                    indexAxis: 'y', // Horizontal
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { 
                            ticks: { color: textColor, stepSize: 1 },
                            grid: { color: isDarkMode.value ? '#334155' : '#e2e8f0' }
                        },
                        y: { 
                            ticks: { color: textColor },
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        title: { display: false }
                    }
                }
            });
        };

        const generatePDF = async () => {
            const element = document.getElementById('reportContent');
            if(!element) return;
            try {
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
                const canvas = await window.html2canvas(element, { scale: 4, backgroundColor: isDarkMode.value ? '#1e293b' : '#ffffff' });
                const link = document.createElement('a');
                link.download = `Print_${reportType.value}.png`;
                link.href = canvas.toDataURL();
                link.click();
            } catch(e) { console.error(e); alert("Erro ao gerar Print."); }
        };

        let dailyChartInstances = {};

        const createDailyChart = (canvasId, score, meta) => {
            // Aguarda para garantir que o canvas foi renderizado
            setTimeout(() => {
                const ctx = document.getElementById(canvasId);
                if (!ctx) {
                    console.warn(`Canvas não encontrado: ${canvasId}`);
                    return;
                }

                // Destroir gráfico anterior
                if (dailyChartInstances[canvasId]) {
                    dailyChartInstances[canvasId].destroy();
                }

                // Determinar cor baseado no score
                let chartColor = '';
                if (score >= 95) {
                    chartColor = '#10B981'; // Verde - Excelente
                } else if (score >= meta) {
                    chartColor = '#3B82F6'; // Azul - Ok
                } else if (score >= 50) {
                    chartColor = '#F59E0B'; // Amarelo - Atenção
                } else {
                    chartColor = '#EF4444'; // Vermelho - Crítico
                }

                try {
                    dailyChartInstances[canvasId] = new Chart(ctx, {
                        type: 'doughnut',
                        data: {
                            labels: ['Completo', 'Incompleto'],
                            datasets: [{
                                data: [score, 100 - score],
                                backgroundColor: [
                                    chartColor,
                                    '#E5E7EB'
                                ],
                                borderColor: [
                                    chartColor,
                                    '#D1D5DB'
                                ],
                                borderWidth: 2,
                                cutout: '60%'
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: true,
                            plugins: {
                                legend: {
                                    display: false
                                },
                                tooltip: {
                                    enabled: true
                                }
                            }
                        }
                    });
                } catch(e) {
                    console.error('Erro ao criar gráfico:', e);
                }
            }, 100);  // 100ms delay para garantir renderização
        };

        // === DEBUG: Verificar escala por data ===
        const debugSchedule = (startDate, days = 10) => {
            console.log(`\n🔍 DEBUG ESCALA 12x36 (PAR/ÍMPAR) - Início: ${startDate}`);
            console.log('='.repeat(70));
            console.log('Lógica: Pares=Eq3+4 | Ímpares=Eq1+2 | Mês 31dias=INVERTE');
            console.log('='.repeat(70));
            
            for (let i = 0; i < days; i++) {
                const date = new Date(startDate + 'T06:00:00');
                date.setDate(date.getDate() + i);
                const dateStr = date.toISOString().split('T')[0];
                
                const dayOfMonth = parseInt(dateStr.split('-')[2]);
                const month = parseInt(dateStr.split('-')[1]);
                
                const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
                const isMonth31Days = daysInMonth[month - 1] === 31;
                
                const isDayEven = dayOfMonth % 2 === 0;
                const dayType = isDayEven ? 'PAR' : 'ÍMPAR';
                const monthType = isMonth31Days ? '(31 dias)' : '(30 dias)';
                
                const periods = getSchedulePeriods(dateStr);
                const teams = periods.map(p => p.team).join(' + ');
                
                console.log(`${dateStr} - Dia ${dayOfMonth} (${dayType}) ${monthType}: ${teams}`);
            }
            console.log('='.repeat(70) + '\n');
        };

        // === DEBUG: Adicionar ao return para testes ===
        const getIncompletePoints = (report) => {
            return report.points.filter(p => !p.checked);
        };

        // Verifica se uma equipe estava trabalhando em uma data específica
        const isTeamWorkingOnDate = (date, team) => {
            const periods = getSchedulePeriods(date);
            return periods.some(p => p.team === team);
        };

        const addPoint = async () => {
            if (!newPointName.value.trim()) return;
            try { const r = await addDoc(collection(db, "config_pontos"), { name: newPointName.value }); pointsConfig.value.push({id:r.id, name:newPointName.value}); newPointName.value=''; } catch(e){}
        };
        const deletePoint = async (id) => { if(confirm('Remover?')) { await deleteDoc(doc(db,"config_pontos",id)); pointsConfig.value=pointsConfig.value.filter(p=>p.id!==id); }};

        // === ESCALA 12x36 - FUNÇÕES ===
        const calculateScheduleTeam = (date, hours) => {
            // date formato: 'YYYY-MM-DD'
            // hours: 0 (6h-18h) ou 12 (18h-6h)
            
            const dayOfMonth = parseInt(date.split('-')[2]);
            const monthStr = date.split('-')[1];
            const month = parseInt(monthStr);
            
            // Dias do mês para cada mês (índice 0 = janeiro)
            const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
            
            // Verificar se o mês tem 31 dias
            const isMonth31Days = daysInMonth[month - 1] === 31;
            
            // Determinar se o dia é par ou ímpar
            const isDayEven = dayOfMonth % 2 === 0;
            
            // Lógica da escala:
            // - Mês normal (30 dias): Par=Eq3+Eq4, Ímpar=Eq1+Eq2
            // - Mês com 31 dias: INVERTE - Par=Eq1+Eq2, Ímpar=Eq3+Eq4
            
            let useEquipe34 = isDayEven;
            if (isMonth31Days) {
                useEquipe34 = !useEquipe34; // Inverte em meses com 31 dias
            }
            
            // Retornar equipe baseado no horário
            if (useEquipe34) {
                // Equipe 3 ou 4
                return hours === 0 ? 'Equipe 3' : 'Equipe 4';
            } else {
                // Equipe 1 ou 2
                return hours === 0 ? 'Equipe 1' : 'Equipe 2';
            }
        };

        const getSchedulePeriods = (date) => {
            // Em um dia de 24h, há 2 períodos de 12h
            // Cada período tem uma equipe diferente
            const periods = [];
            for (let i = 0; i < 2; i++) {  // Apenas 2 períodos por dia (0-11h e 12-23h)
                const startHour = i * 12;
                const endHour = (i + 1) * 12;
                const team = calculateScheduleTeam(date, startHour);
                const startTime = String(startHour % 24).padStart(2, '0') + ':00';
                const endTime = String(endHour % 24).padStart(2, '0') + ':00';
                periods.push({
                    team,
                    startTime,
                    endTime,
                    period: i + 1
                });
            }
            return periods;
        };

        const loadPendingChecks = async () => {
            if (!db) return;
            loadingPending.value = true;
            try {
                const today = new Date().toISOString().split('T')[0];
                const periods = getSchedulePeriods(today);
                
                const q = query(collection(db, "inspections"), where("date", "==", today));
                const snapshot = await getDocs(q);
                
                const completedTeams = new Set();
                snapshot.forEach(doc => {
                    completedTeams.add(doc.data().team);
                });

                pendingChecks.value = periods.map(period => ({
                    team: period.team,
                    period: period.period,
                    startTime: period.startTime,
                    endTime: period.endTime,
                    date: today,
                    isPending: !completedTeams.has(period.team),
                    isCompleted: completedTeams.has(period.team)
                }));
            } catch (e) {
                console.error('Erro ao carregar pendências:', e);
            } finally {
                loadingPending.value = false;
            }
        };

        // === HISTÓRICO DE PENDÊNCIAS ===
        const loadPendingHistory = async () => {
            if (!db) return;
            loadingPendingHistory.value = true;
            try {
                const today = new Date();
                const daysAgo = parseInt(selectedDateRange.value);
                const limitDate = new Date(today.getTime() - daysAgo * 24 * 60 * 60 * 1000)
                    .toISOString().split('T')[0];
                
                const q = query(
                    collection(db, "inspections"),
                    where("date", ">=", limitDate),
                    orderBy("date", "desc")
                );
                
                const snapshot = await getDocs(q);
                const inspections = new Map();
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const key = `${data.date}-${data.team}`;
                    if (!inspections.has(key)) {
                        inspections.set(key, data);
                    }
                });
                
                const history = [];
                for (let i = daysAgo; i >= 0; i--) {
                    const checkDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
                        .toISOString().split('T')[0];
                    
                    const periods = getSchedulePeriods(checkDate);
                    
                    periods.forEach(period => {
                        // Validação: Verificar se a equipe realmente estava trabalhando
                        if (!isTeamWorkingOnDate(checkDate, period.team)) {
                            return; // Pula equipes que não estavam trabalhando
                        }

                        const key = `${checkDate}-${period.team}`;
                        const inspection = inspections.get(key);
                        
                        if (!inspection) {
                            const daysInPending = Math.floor(
                                (new Date() - new Date(checkDate)) / (24 * 60 * 60 * 1000)
                            );
                            
                            history.push({
                                date: checkDate,
                                team: period.team,
                                period: period.period,
                                startTime: period.startTime,
                                endTime: period.endTime,
                                isPending: true,
                                daysInPending,
                                resolvedDate: null
                            });
                        } else {
                            history.push({
                                date: checkDate,
                                team: period.team,
                                period: period.period,
                                startTime: period.startTime,
                                endTime: period.endTime,
                                isPending: false,
                                daysInPending: 0,
                                resolvedDate: inspection.updatedAt
                            });
                        }
                    });
                }
                
                let filtered = history;
                if (selectedTeamFilter.value !== 'Todas') {
                    filtered = history.filter(h => h.team === selectedTeamFilter.value);
                }
                
                filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                pendingHistory.value = filtered;
            } catch (e) {
                console.error('Erro ao carregar histórico de pendências:', e);
            } finally {
                loadingPendingHistory.value = false;
            }
        };

        const markPendingAsResolved = async (pendingItem) => {
            try {
                const docRef = doc(db, "inspections", `${pendingItem.date}-${pendingItem.team}`);
                await setDoc(docRef, {
                    date: pendingItem.date,
                    team: pendingItem.team,
                    score: 0,
                    points: [],
                    observation: "Pendência marcada como resolvida manualmente",
                    user: user.value.email,
                    updatedAt: new Date().toISOString(),
                    resolvedManually: true
                });
                
                await loadPendingHistory();
                alert('Pendência marcada como resolvida!');
            } catch (e) {
                console.error('Erro ao marcar como resolvida:', e);
                alert('Erro ao marcar pendência');
            }
        };

        return {
            user, authMode, authForm, authError, loading, handleAuth, logout,
            currentView, menuItems, currentTeam, currentDate, points, progress, meta, loadingPoints, saving, 
            pointsConfig, newPointName, addPoint, deletePoint, 
            isDarkMode, toggleDarkMode, toggleAllPoints, allSelected, inspectionObservation,
            reportType, reportMonth, reportYear, dailyDate, loadingReports, teamStats, dailyDataList,
            generatePDF, takeScreenshot, saveInspection, togglePoint, saveMeta,
            historyList, loadingHistory, historyMonth, editFromHistory, deleteInspection,
            topOffenders,
            // ESCALA 12x36
            pendingChecks, loadingPending, loadPendingChecks, getSchedulePeriods, calculateScheduleTeam, teamsSchedule,
            // HISTÓRICO DE PENDÊNCIAS
            pendingHistory, loadingPendingHistory, loadPendingHistory, selectedTeamFilter, selectedDateRange, markPendingAsResolved,
            // GRÁFICO PIZZA V5
            createDailyChart, getIncompletePoints,
            // DEBUG
            debugSchedule
        };
    }
}).mount('#app')
