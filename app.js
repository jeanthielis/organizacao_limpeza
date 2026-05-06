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
        
        // CORREÇÃO 1: Função para obter data em timezone local (não UTC)
        const getDayInLocalTimezone = () => {
            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        const dailyDate = ref(getDayInLocalTimezone());
        const reportGeneratedAt = ref(null); // Para tracking quando o relatório foi gerado
        
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

        // === SISTEMA DE TOAST (SweetAlert2) ===
        const toasts = ref([]);
        const resolveConfirm = () => {};

        const toast = (message, type = 'info', duration = 3500) => {
            const icons = { success: 'success', error: 'error', warning: 'warning', info: 'info' };
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: icons[type] || 'info',
                title: message,
                showConfirmButton: false,
                timer: duration,
                timerProgressBar: true,
                didOpen: (el) => {
                    el.addEventListener('mouseenter', Swal.stopTimer);
                    el.addEventListener('mouseleave', Swal.resumeTimer);
                }
            });
        };

        const showConfirm = (message) => {
            return Swal.fire({
                title: 'Confirmar',
                text: message,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#EF4444',
                cancelButtonColor: '#64748b',
                confirmButtonText: 'Confirmar',
                cancelButtonText: 'Cancelar',
                borderRadius: '16px'
            }).then(result => result.isConfirmed);
        };


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

        const loadMasterPoints = async () => {
            if (!db) return;
            loadingPoints.value = true;
            try {
                const snapshot = await getDocs(collection(db, "pontos_inspecao"));
                pointsConfig.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (e) { console.error(e); } 
            finally { loadingPoints.value = false; }
        };

        const addPoint = async () => {
            if (!db || !newPointName.value.trim()) return;
            try {
                await addDoc(collection(db, "pontos_inspecao"), { name: newPointName.value });
                newPointName.value = '';
                await loadMasterPoints();
                toast('Ponto adicionado!', 'success');
            } catch (e) { console.error(e); toast("Erro ao adicionar", "error"); }
        };

        const deletePoint = async (pointId) => {
            if (!db) return;
            const confirmed = await showConfirm('Deseja deletar este ponto?');
            if (!confirmed) return;
            try {
                await deleteDoc(doc(db, "pontos_inspecao", pointId));
                await loadMasterPoints();
                toast('Ponto removido!', 'success');
            } catch (e) { console.error(e); toast("Erro ao deletar", "error"); }
        };

        const initializeChecklist = async () => {
            if (!db || pointsConfig.value.length === 0) return;
            loadingPoints.value = true;
            try {
                const docId = `${currentTeam.value}_${currentDate.value}`;
                const docRef = doc(db, "inspections", docId);
                const snap = await getDoc(docRef);
                
                if (snap.exists()) {
                    const data = snap.data();
                    points.value = pointsConfig.value.map(p => {
                        const existing = data.points?.find(x => x.name === p.name);
                        return { name: p.name, id: p.id, checked: existing?.checked ?? false };
                    });
                    inspectionObservation.value = data.observation || '';
                } else {
                    points.value = pointsConfig.value.map(p => ({ name: p.name, id: p.id, checked: false }));
                    inspectionObservation.value = '';
                }
            } catch (e) { console.error(e); } 
            finally { loadingPoints.value = false; }
        };

        const saveInspection = async () => {
            if (!db) return;
            saving.value = true;
            try {
                const docId = `${currentTeam.value}_${currentDate.value}`;
                const docRef = doc(db, "inspections", docId);
                const checkedCount = points.value.filter(p => p.checked).length;
                const score = (checkedCount / points.value.length) * 100;
                
                await setDoc(docRef, {
                    date: currentDate.value,
                    team: currentTeam.value,
                    score: parseFloat(score.toFixed(2)),
                    points: points.value,
                    observation: inspectionObservation.value,
                    user: user.value.email,
                    updatedAt: new Date().toISOString()
                });
                
                toast('Inspeção salva com sucesso!', 'success');
            } catch (e) { console.error(e); toast("Erro ao salvar", "error"); } 
            finally { saving.value = false; }
        };

        const loadHistory = async () => {
            if (!db || !user.value) return;
            loadingHistory.value = true;
            historyList.value = [];
            try {
                const startStr = historyMonth.value + "-01";
                const endStr = historyMonth.value + "-31";
                const q = query(collection(db, "inspections"), where("date", ">=", startStr), where("date", "<=", endStr), orderBy("date", "desc"));
                const snapshot = await getDocs(q);
                historyList.value = snapshot.docs.map(doc => doc.data());
            } catch (e) { console.error(e); } 
            finally { loadingHistory.value = false; }
        };

        const editFromHistory = (item) => {
            currentTeam.value = item.team;
            currentDate.value = item.date;
            currentView.value = 'inspection';
        };

        const deleteInspection = async (item) => {
            if (!db) return;
            const confirmed = await showConfirm('Deseja deletar esta inspeção?');
            if (!confirmed) return;
            try {
                const docId = `${item.team}_${item.date}`;
                await deleteDoc(doc(db, "inspections", docId));
                await loadHistory();
                toast('Inspeção deletada!', 'success');
            } catch (e) { console.error(e); toast("Erro ao deletar", "error"); }
        };

        const saveMeta = async () => {
            if (!db) return;
            try {
                const docRef = doc(db, "config_geral", "meta_padrao");
                await setDoc(docRef, { valor: meta.value });
                toast('Meta atualizada!', 'success');
            } catch (e) { console.error(e); toast("Erro ao atualizar", "error"); }
        };

        const getIncompletePoints = (report) => report.points?.filter(p => !p.checked) || [];

        // CORREÇÃO 2: Nova função loadReports com logs e tratamento robusto
        const loadReports = async () => {
            if (!db || !user.value) {
                console.warn('⚠️ [loadReports] DB ou User não inicializados');
                return;
            }
            
            loadingReports.value = true;
            teamStats.value = [];
            dailyDataList.value = [];
            topOffenders.value = [];
            reportGeneratedAt.value = null;

            console.log('📊 [loadReports] Iniciando carregamento:', {
                tipo: reportType.value,
                data: {
                    mensal: reportMonth.value,
                    anual: reportYear.value,
                    diária: dailyDate.value
                },
                usuário: user.value.email,
                timestamp: new Date().toISOString()
            });

            try {
                let failures = {};

                if (reportType.value === 'monthly') {
                    console.log('📅 [loadReports] Tipo MONTHLY detectado:', reportMonth.value);
                    
                    const startStr = reportMonth.value + "-01";
                    const endStr = reportMonth.value + "-31";
                    
                    console.log(`🔍 Query: date >= "${startStr}" AND date <= "${endStr}"`);
                    
                    const q = query(
                        collection(db, "inspections"), 
                        where("date", ">=", startStr), 
                        where("date", "<=", endStr)
                    );
                    const snapshot = await getDocs(q);
                    
                    console.log(`✅ Documentos encontrados: ${snapshot.size}`);
                    
                    const stats = {};
                    const daysWorkedByTeam = {};
                    
                    const [year, month] = reportMonth.value.split('-');
                    const daysInMonth = new Date(year, month, 0).getDate();
                    
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
                        const score = parseFloat(d.score) || 0;
                        
                        if (!stats[d.team]) {
                            stats[d.team] = { total: 0, count: 0, name: d.team };
                        }
                        stats[d.team].total += score;
                        stats[d.team].count++;

                        if (d.points) {
                            d.points.forEach(p => {
                                if (!p.checked) {
                                    failures[p.name] = (failures[p.name] || 0) + 1;
                                }
                            });
                        }
                    });
                    
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

                    topOffenders.value = Object.entries(failures)
                        .map(([name, count]) => ({ name, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5);

                    console.log('✅ [loadReports] MONTHLY concluído:', {
                        equipes: teamStats.value.length,
                        ofensores: topOffenders.value.length
                    });
                } 
                else if (reportType.value === 'annual') {
                    console.log('📅 [loadReports] Tipo ANNUAL detectado:', reportYear.value);
                    
                    const startStr = reportYear.value + "-01-01";
                    const endStr = reportYear.value + "-12-31";
                    
                    const q = query(
                        collection(db, "inspections"), 
                        where("date", ">=", startStr), 
                        where("date", "<=", endStr)
                    );
                    const snapshot = await getDocs(q);
                    
                    console.log(`✅ Documentos encontrados: ${snapshot.size}`);
                    
                    const rawData = [];
                    
                    snapshot.forEach(doc => {
                        const d = doc.data();
                        rawData.push(d);

                        if (d.points) {
                            d.points.forEach(p => {
                                if (!p.checked) {
                                    failures[p.name] = (failures[p.name] || 0) + 1;
                                }
                            });
                        }
                    });

                    const teamsData = {};
                    ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4'].forEach(t => {
                        teamsData[t] = Array(12).fill({ total: 0, count: 0 });
                    });
                    
                    rawData.forEach(d => {
                        if (teamsData[d.team]) {
                            const month = parseInt(d.date.split('-')[1]) - 1; 
                            teamsData[d.team][month] = { 
                                total: teamsData[d.team][month].total + (parseFloat(d.score)||0), 
                                count: teamsData[d.team][month].count + 1 
                            };
                        }
                    });
                    
                    teamStats.value = Object.keys(teamsData).map(t => ({ 
                        name: t, 
                        data: teamsData[t].map(m => m.count > 0 ? parseFloat((m.total / m.count).toFixed(1)) : null) 
                    }));
                    
                    topOffenders.value = Object.entries(failures)
                        .map(([name, count]) => ({ name, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5);

                    console.log('✅ [loadReports] ANNUAL concluído:', {
                        equipes: teamStats.value.length,
                        ofensores: topOffenders.value.length
                    });
                }
                else if (reportType.value === 'daily') {
                    console.log('📅 [loadReports] Tipo DAILY detectado:', dailyDate.value);
                    console.log('⏰ Timezone local confirmado - Data selecionada:', dailyDate.value);
                    
                    // CORREÇÃO CRITICAL: Usar a data exatamente como selecionada
                    const q = query(
                        collection(db, "inspections"), 
                        where("date", "==", dailyDate.value)
                    );
                    
                    console.log(`🔍 Query executada: date == "${dailyDate.value}"`);
                    
                    const snapshot = await getDocs(q);
                    console.log(`✅ Documentos encontrados: ${snapshot.size}`);
                    
                    let list = [];
                    const teamsWorkingToday = getSchedulePeriods(dailyDate.value).map(p => p.team);
                    
                    console.log(`📋 Equipes trabalhando em ${dailyDate.value}:`, teamsWorkingToday);
                    
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        console.log(`  ✓ Documento encontrado:`, {
                            equipe: data.team,
                            score: data.score,
                            pontos: data.points?.length || 0
                        });
                        
                        if (teamsWorkingToday.includes(data.team)) {
                            list.push(data);
                        } else {
                            console.warn(`  ⚠️ Equipe ${data.team} não estava trabalhando nesta data`);
                        }
                    });
                    
                    list.sort((a, b) => a.team.localeCompare(b.team));
                    dailyDataList.value = list;
                    reportGeneratedAt.value = new Date().toLocaleString('pt-BR');
                    
                    // NOVO: Feedback para relatório vazio
                    if (list.length === 0) {
                        console.warn('⚠️ [loadReports] AVISO: Nenhum relatório encontrado para esta data!');
                        toast(`ℹ️ Nenhuma inspeção registrada para ${dailyDate.value}`, 'info', 4000);
                    } else {
                        toast(`✅ Relatório carregado com sucesso (${list.length} equipe(s))`, 'success', 2500);
                    }

                    console.log('✅ [loadReports] DAILY concluído:', {
                        registros: list.length,
                        geradoEm: reportGeneratedAt.value
                    });
                }

                loadingReports.value = false;
                console.log('🎉 [loadReports] Carregamento FINALIZADO com sucesso');

            } catch (e) { 
                console.error('🔴 [loadReports] ERRO CAPTURADO:', {
                    mensagem: e.message,
                    stack: e.stack,
                    timestamp: new Date().toISOString()
                });
                
                toast(`❌ Erro ao carregar relatório: ${e.message}`, 'error', 5000);
                loadingReports.value = false;
            }
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
            } catch(e) { console.error(e); toast("Erro ao gerar PDF", "error"); }
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
            } catch(e) { console.error(e); toast("Erro ao gerar print", "error"); }
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
            }, 100);
        };

        // === DEBUG: Verificar escala por data ===
        const debugSchedule = (startDate, days = 10) => {
            console.log(`\n🔍 DEBUG ESCALA 12x36 (PAR/ÍMPAR) - Início: ${startDate}`);
            console.log('='.repeat(70));
            console.log('Lógica: Pares=Eq3+4 | Ímpares=Eq1+2 | Mês 31dias=INVERTE');
            console.log('='.repeat(70));
            
            for (let i = 0; i < days; i++) {
                const date = new Date(startDate);
                date.setDate(date.getDate() + i);
                const dateStr = date.toISOString().split('T')[0];
                const day = date.getDate();
                const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
                
                const isOdd = day % 2 === 1;
                const hasInversion = daysInMonth === 31;
                const teams = getSchedulePeriods(dateStr).map(p => p.team).join(', ');
                
                console.log(`${dateStr} (dia ${day} - ${isOdd ? 'ÍMPAR' : 'PAR'}${hasInversion ? ' com INVERSÃO' : ''}): ${teams}`);
            }
            console.log('='.repeat(70));
        };

        // === LIMPEZA: Remover inspeções duplicadas ===
        const cleanDuplicates = async () => {
            if (!db) return;
            console.log('🧹 Iniciando limpeza de duplicatas...');
            try {
                const snapshot = await getDocs(collection(db, "inspections"));
                const map = new Map();
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const key = `${data.date}-${data.team}`;
                    if (!map.has(key)) {
                        map.set(key, []);
                    }
                    map.get(key).push(doc.id);
                });
                
                for (const [key, ids] of map.entries()) {
                    if (ids.length > 1) {
                        console.log(`Duplicata encontrada: ${key} (${ids.length} cópias)`);
                        // Manter a primeira, deletar as outras
                        for (let i = 1; i < ids.length; i++) {
                            await deleteDoc(doc(db, "inspections", ids[i]));
                            console.log(`  ✓ Deletado: ${ids[i]}`);
                        }
                    }
                }
                console.log('✅ Limpeza concluída!');
            } catch (e) {
                console.error('❌ Erro na limpeza:', e);
            }
        };

        const isTeamWorkingOnDate = (dateStr, team) => {
            const periods = getSchedulePeriods(dateStr);
            return periods.some(p => p.team === team);
        };

        const calculateScheduleTeam = (dateStr) => {
            const [year, month, day] = dateStr.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            const dayNum = day;
            
            const isOdd = dayNum % 2 === 1;
            const hasInversion = daysInMonth === 31;
            const shouldInvert = (isOdd && hasInversion) || (!isOdd && !hasInversion);
            
            if (shouldInvert) {
                return ['Equipe 3', 'Equipe 4'];
            } else {
                return ['Equipe 1', 'Equipe 2'];
            }
        };

        const getSchedulePeriods = (dateStr) => {
            const teamsOnDate = calculateScheduleTeam(dateStr);
            const periods = [];
            
            for (let i = 0; i < 3; i++) {
                for (const team of teamsOnDate) {
                    const startHour = 6 + (i * 8);
                    const endHour = startHour + 8;
                    const startTime = String(startHour % 24).padStart(2, '0') + ':00';
                    const endTime = String(endHour % 24).padStart(2, '0') + ':00';
                    periods.push({
                        team,
                        startTime,
                        endTime,
                        period: i + 1
                    });
                }
            }
            return periods;
        };

        const loadPendingChecks = async () => {
            if (!db) return;
            loadingPending.value = true;
            try {
                const today = getDayInLocalTimezone();
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
                // ✅ Usar o MESMO formato de docId que saveInspection: team_date
                const docId = `${pendingItem.team}_${pendingItem.date}`;
                const docRef = doc(db, "inspections", docId);
                
                // Verificar se já existe inspeção real antes de criar
                const existing = await getDoc(docRef);
                if (existing.exists() && existing.data().score > 0) {
                    toast('Inspeção já realizada com ' + existing.data().score.toFixed(0) + '% de aproveitamento!', 'warning');
                    await loadPendingHistory();
                    return;
                }
                
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
                toast('Pendência marcada como resolvida!', 'success');
            } catch (e) {
                console.error('Erro ao marcar como resolvida:', e);
                toast('Erro ao marcar pendência', 'error');
            }
        };

        // CORREÇÃO 3: Função para gerar relatório manual
        const generateDailyReportManually = async () => {
            console.log('👆 [generateDailyReportManually] Usuário clicou no botão Gerar');
            console.log('Data selecionada:', dailyDate.value);
            
            if (!dailyDate.value) {
                toast('⚠️ Selecione uma data antes de gerar o relatório', 'warning');
                return;
            }
            
            await loadReports();
        };

        // CORREÇÃO 4: Função auxiliar de debug
        const debugDailyReportIssue = async () => {
            console.log('%c🔍 DEBUG: INVESTIGANDO PROBLEMA DO RELATÓRIO DIÁRIO', 'color: blue; font-size: 14px; font-weight: bold');
            
            const dateSelected = dailyDate.value;
            console.log(`Data selecionada: ${dateSelected}`);
            console.log(`Hora local: ${new Date().toString()}`);
            console.log(`Timezone offset: ${new Date().getTimezoneOffset()} minutos`);
            
            try {
                const q = query(collection(db, "inspections"), where("date", "==", dateSelected));
                const snapshot = await getDocs(q);
                
                console.log(`\nDocumentos COM data == "${dateSelected}": ${snapshot.size}`);
                snapshot.forEach(doc => {
                    const d = doc.data();
                    console.log(`  - ${d.team}: ${d.score}% (${d.points?.length || 0} pontos)`);
                });
                
                const allDocs = await getDocs(collection(db, "inspections"));
                const uniqueDates = new Set();
                allDocs.forEach(doc => uniqueDates.add(doc.data().date));
                
                console.log(`\n📊 Todas as datas no banco (${uniqueDates.size} únicas):`);
                Array.from(uniqueDates).sort().slice(-10).forEach(date => {
                    console.log(`  - ${date}`);
                });
                
                console.log('\n✅ Debug concluído. Verifique a saída acima.');
                
            } catch (e) {
                console.error('Erro ao executar debug:', e);
            }
        };

        return {
            user, authMode, authForm, authError, loading, handleAuth, logout,
            currentView, menuItems, currentTeam, currentDate, points, progress, meta, loadingPoints, saving, 
            pointsConfig, newPointName, addPoint, deletePoint, 
            isDarkMode, toggleDarkMode, toggleAllPoints, allSelected, inspectionObservation,
            reportType, reportMonth, reportYear, dailyDate, loadingReports, teamStats, dailyDataList, reportGeneratedAt,
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
            debugSchedule, debugDailyReportIssue,
            // LIMPEZA
            cleanDuplicates,
            // RELATÓRIOS CORRIGIDO
            loadReports, generateDailyReportManually,
            // TOAST
            toasts, resolveConfirm
        };
    }
}).mount('#app')
