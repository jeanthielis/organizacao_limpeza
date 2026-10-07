import { createApp, ref, computed, onMounted, watch, nextTick } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
import {
  db, auth,
  collection, addDoc, getDocs, doc, deleteDoc, query, setDoc, updateDoc,
  where, getDoc, orderBy, limit, arrayUnion,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail,
  verifyPasswordResetCode, confirmPasswordReset, updatePassword,
  createUserAsAdmin
} from './firebase.js?v=3.7.0'

createApp({
  setup() {
    /* ==================== ESTADO GERAL ==================== */
    const booting = ref(true)
    const user = ref(null)              // usuário do Firebase Auth
    const profile = ref(null)           // documento users/{uid}
    const profileMissing = ref(false)   // logado no Auth mas sem cadastro
    const authForm = ref({ email: '', password: '', name: '' })
    const authError = ref('')
    const loading = ref(false)
    const isDarkMode = ref(localStorage.getItem('darkMode') === 'true')

    const isAdmin = computed(() => profile.value?.role === 'admin')
    const myTeam = computed(() => profile.value?.team || '')

    /* ==================== NOTIFICAÇÕES ==================== */
    const notifications = ref([])
    let notificationId = 0
    const showNotification = (message, type = 'info', duration = 3200) => {
      const id = ++notificationId
      notifications.value.push({ id, message, type })
      if (duration > 0) setTimeout(() => removeNotification(id), duration)
      return id
    }
    const removeNotification = (id) => { notifications.value = notifications.value.filter(n => n.id !== id) }
    const showSuccess = (m, d = 3000) => showNotification(m, 'success', d)
    const showError = (m, d = 5000) => showNotification(m, 'error', d)
    const showWarning = (m, d = 4000) => showNotification(m, 'warning', d)
    const showInfo = (m, d = 3000) => showNotification(m, 'info', d)

    /* ==================== VERSÃO ==================== */
    const appVersion = ref('3.7.0')
    const versionStatus = ref('Stable')
    const versionInfo = ref({})
    const loadVersionInfo = async () => {
      try {
        const r = await fetch('./version.json')
        if (!r.ok) return
        const d = await r.json()
        appVersion.value = d.version
        versionStatus.value = (d.status || '').charAt(0).toUpperCase() + (d.status || '').slice(1)
        versionInfo.value = d
      } catch (e) { /* offline */ }
    }

    /* ==================== NAVEGAÇÃO ==================== */
    const currentView = ref('audit')
    const menuItems = computed(() => {
      const base = [
        { id: 'audit', label: 'Auditar', icon: 'fas fa-clipboard-check' },
        { id: 'audits', label: 'Auditorias', icon: 'fas fa-inbox' },
        { id: 'reports', label: 'Relatórios', icon: 'fas fa-chart-pie' }
      ]
      if (isAdmin.value) base.push({ id: 'admin', label: 'Admin', icon: 'fas fa-user-shield' })
      base.push({ id: 'about', label: 'Sobre', icon: 'fas fa-circle-info' })
      return base
    })

    /* ==================== CONFIGURAÇÃO ==================== */
    const ADM_TEAM = 'ADM'
    const DEFAULT_TEAMS = ['Equipe 1', 'Equipe 2', 'Equipe 3', 'Equipe 4', ADM_TEAM]
    // Rodízio: quem chega audita quem sai
    const DEFAULT_ROTATION = { 'Equipe 1': 'Equipe 4', 'Equipe 4': 'Equipe 3', 'Equipe 3': 'Equipe 2', 'Equipe 2': 'Equipe 1' }
    const SHIFTS = ['Dia', 'Noite']

    const teams = ref([...DEFAULT_TEAMS])
    const opTeams = computed(() => teams.value.filter(t => t !== ADM_TEAM))
    const rotation = ref({ ...DEFAULT_ROTATION })
    const meta = ref(93)
    const pointsConfig = ref([])
    const newPointName = ref('')
    const configLoaded = ref(false)

    const loadConfig = async () => {
      if (!db) return
      try {
        const [mSnap, rSnap, tSnap, eSnap] = await Promise.all([
          getDoc(doc(db, 'config_geral', 'meta_padrao')),
          getDoc(doc(db, 'config_geral', 'rodizio')),
          getDoc(doc(db, 'config_geral', 'equipes')),
          getDoc(doc(db, 'config_geral', 'escala'))
        ])
        if (eSnap.exists()) scale.value = { ...DEFAULT_SCALE, ...eSnap.data() }
        if (mSnap.exists()) meta.value = mSnap.data().valor ?? 93
        if (tSnap.exists() && Array.isArray(tSnap.data().lista) && tSnap.data().lista.length) teams.value = tSnap.data().lista
        if (rSnap.exists() && rSnap.data().mapa) rotation.value = rSnap.data().mapa
        else rotation.value = { ...DEFAULT_ROTATION }
      } catch (e) { console.warn('Config padrão em uso:', e.message) }
      configLoaded.value = true
    }

    const loadMasterPoints = async () => {
      if (!db) return
      loadingPoints.value = true
      try {
        const snap = await getDocs(query(collection(db, 'config_pontos')))
        const list = []
        snap.forEach(d => list.push({ id: d.id, ...d.data() }))
        list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || String(a.name).localeCompare(String(b.name)))
        pointsConfig.value = list.map(p => ({ ...p, area: p.area || 'Geral', peso: p.peso || 1 }))
      } catch (e) { console.error('Erro ao carregar pontos:', e) }
      finally { loadingPoints.value = false }
    }

    /* ==================== AUDITORIA ==================== */
    const loadingPoints = ref(false)
    const saving = ref(false)
    const auditDate = ref(new Date().toISOString().split('T')[0])
    const auditShift = ref(new Date().getHours() >= 6 && new Date().getHours() < 18 ? 'Dia' : 'Noite')
    const adminAuditorTeam = ref('')      // admin pode escolher a equipe auditora
    const points = ref([])
    const showErrors = ref(false)
    const uploadingIndex = ref(null)

    /* ==================== ESCALA 12x36 ==================== */
    const DEFAULT_SCALE = {
      ativo: true,
      dataRef: new Date().toISOString().slice(0, 10),
      diaA: 'Equipe 1', noiteA: 'Equipe 2',
      diaB: 'Equipe 3', noiteB: 'Equipe 4',
      inicioDia: 6, inicioNoite: 18
    }
    const scale = ref({ ...DEFAULT_SCALE })

    const DAY_MS = 86400000
    const toUTC = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, m - 1, d) }
    const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10)
    const addDays = (iso, n) => isoOf(toUTC(iso) + n * DAY_MS)
    const localToday = () => { const n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

    const cycleIndex = (iso) => {
      const diff = Math.round((toUTC(iso) - toUTC(scale.value.dataRef || localToday())) / DAY_MS)
      return ((diff % 2) + 2) % 2
    }
    const teamFor = (iso, shift) => {
      const isA = cycleIndex(iso) === 0
      return shift === 'Dia'
        ? (isA ? scale.value.diaA : scale.value.diaB)
        : (isA ? scale.value.noiteA : scale.value.noiteB)
    }
    const prevShift = (iso, shift) => shift === 'Dia' ? { date: addDays(iso, -1), shift: 'Noite' } : { date: iso, shift: 'Dia' }
    const nextShift = (iso, shift) => shift === 'Dia' ? { date: iso, shift: 'Noite' } : { date: addDays(iso, 1), shift: 'Dia' }

    const currentShift = () => {
      const now = new Date()
      const h = now.getHours() + now.getMinutes() / 60
      const t = localToday()
      if (h < scale.value.inicioDia) return { date: addDays(t, -1), shift: 'Noite' }
      if (h < scale.value.inicioNoite) return { date: t, shift: 'Dia' }
      return { date: t, shift: 'Noite' }
    }
    const shiftEndMs = (iso, shift) => {
      const [y, m, d] = String(iso).split('-').map(Number)
      return shift === 'Dia'
        ? new Date(y, m - 1, d, scale.value.inicioNoite, 0, 0).getTime()
        : new Date(y, m - 1, d + 1, scale.value.inicioDia, 0, 0).getTime()
    }
    const hh = (n) => String(n).padStart(2, '0') + 'h'

    const shiftNow = computed(() => {
      const cs = currentShift()
      const ns = nextShift(cs.date, cs.shift)
      return {
        date: cs.date, shift: cs.shift,
        team: teamFor(cs.date, cs.shift),
        from: cs.shift === 'Dia' ? hh(scale.value.inicioDia) : hh(scale.value.inicioNoite),
        to: cs.shift === 'Dia' ? hh(scale.value.inicioNoite) : hh(scale.value.inicioDia),
        nextTeam: teamFor(ns.date, ns.shift),
        nextAt: cs.shift === 'Dia' ? hh(scale.value.inicioNoite) : hh(scale.value.inicioDia)
      }
    })

    const scalePreview = computed(() => {
      const base = localToday()
      return [0, 1, 2, 3].map(i => {
        const d = addDays(base, i)
        return { date: d, dia: teamFor(d, 'Dia'), noite: teamFor(d, 'Noite'), hoje: i === 0 }
      })
    })

    const applyCurrentShift = () => {
      const cs = currentShift()
      const ps = prevShift(cs.date, cs.shift)
      auditDate.value = ps.date
      auditShift.value = ps.shift
    }

    const auditorTeam = computed(() => {
      if (myTeam.value === ADM_TEAM) return ADM_TEAM
      if (scale.value.ativo) {
        const nx = nextShift(auditDate.value, auditShift.value)
        return teamFor(nx.date, nx.shift) || ''
      }
      return isAdmin.value && adminAuditorTeam.value ? adminAuditorTeam.value : myTeam.value
    })
    const manualAudited = ref('')
    const canAuditAny = computed(() => isAdmin.value || myTeam.value === ADM_TEAM)
    const auditedTeam = computed(() => {
      if (canAuditAny.value && manualAudited.value) return manualAudited.value
      if (scale.value.ativo) return teamFor(auditDate.value, auditShift.value) || ''
      return rotation.value[isAdmin.value && adminAuditorTeam.value ? adminAuditorTeam.value : myTeam.value] || ''
    })
    // A escala indica outra equipe assumindo agora?
    const scaleMismatch = computed(() => scale.value.ativo && !isAdmin.value && myTeam.value !== ADM_TEAM && !!auditorTeam.value && auditorTeam.value !== myTeam.value)

    const okCount = computed(() => points.value.filter(p => p.status === 'ok').length)
    const nokCount = computed(() => points.value.filter(p => p.status === 'nok').length)
    const answeredCount = computed(() => okCount.value + nokCount.value)
    const pesoTotal = computed(() => points.value.reduce((t, p) => t + (p.peso || 1), 0))
    const pesoOk = computed(() => points.value.filter(p => p.status === 'ok').reduce((t, p) => t + (p.peso || 1), 0))
    const progress = computed(() => pesoTotal.value ? Math.round(pesoOk.value / pesoTotal.value * 100) : 0)
    const pointsGrouped = computed(() => {
      const groups = []
      points.value.forEach((p, i) => {
        const area = p.area || 'Geral'
        let g = groups.find(x => x.area === area)
        if (!g) { g = { area, items: [] }; groups.push(g) }
        g.items.push({ p, i })
      })
      return groups
    })
    // Agora a foto do local é obrigatória em TODOS os pontos, conformes ou não
    const pendingPhotos = computed(() => points.value.filter(p => !(p.photoDocId || p.photoUrl)).length)
    const pendingReasons = computed(() => points.value.filter(p => p.status === 'nok' && (p.reason || '').trim().length < 5).length)
    const canSubmit = computed(() =>
      points.value.length > 0 && answeredCount.value === points.value.length &&
      !!auditedTeam.value && pendingPhotos.value === 0 && pendingReasons.value === 0
    )

    const auditDocId = () => `${auditedTeam.value}_${auditDate.value}_${auditShift.value}` +
      (auditorTeam.value === ADM_TEAM ? '_ADM' : '')

    const buildChecklist = () => {
      points.value = pointsConfig.value.map(p => ({
        id: p.id, name: p.name, area: p.area || 'Geral', peso: p.peso || 1,
        status: null, reason: '', photoUrl: '', photoDocId: ''
      }))
      showErrors.value = false
    }

    /* ==================== RASCUNHO: CONTINUAR DE ONDE PAROU ==================== */
    /* A auditoria em andamento é gravada no aparelho a cada alteração. Se o app
       fechar no meio — chamado urgente, bateria, troca de aba — o auditor retoma
       exatamente onde estava. As fotos já vivem no Firestore desde a captura,
       então o rascunho guarda apenas o id de cada uma. */
    const draft = ref(null)          // rascunho encontrado ao abrir
    const draftBanner = ref(false)   // mostra a faixa de retomada
    const draftLoading = ref(false)  // bloqueia o watcher da escala durante a restauração
    const draftSavedAt = ref('')
    const DRAFT_MAX_DIAS = 7
    let draftTimer = null

    const draftKey = () => 'cp_draft_' + (user.value?.uid || 'anon')

    const draftTemConteudo = () =>
      points.value.some(p => p.status || p.photoDocId || p.photoUrl || (p.reason || '').trim())

    const writeDraft = () => {
      if (!user.value || !points.value.length) return
      // Há um rascunho de outro turno esperando decisão: não sobrescrever nem apagar
      if (draftBanner.value) return
      if (!draftTemConteudo()) { clearDraft(false); return }
      try {
        const agora = new Date().toISOString()
        localStorage.setItem(draftKey(), JSON.stringify({
          v: 1,
          auditDate: auditDate.value,
          auditShift: auditShift.value,
          auditedTeam: auditedTeam.value,
          auditorTeam: auditorTeam.value,
          manualAudited: manualAudited.value || '',
          adminAuditorTeam: adminAuditorTeam.value || '',
          points: points.value.map(p => ({
            name: p.name,
            status: p.status,
            reason: p.reason || '',
            photoDocId: p.photoDocId || '',
            photoUrl: p.photoUrl || ''
          })),
          savedAt: agora
        }))
        draftSavedAt.value = agora
      } catch (e) { /* armazenamento cheio ou bloqueado */ }
    }

    // Grava com folga, para não escrever a cada tecla digitada no motivo
    const scheduleDraft = () => {
      clearTimeout(draftTimer)
      draftTimer = setTimeout(writeDraft, 700)
    }
    const flushDraft = () => { clearTimeout(draftTimer); writeDraft() }

    const clearDraft = (limparBanner) => {
      try { localStorage.removeItem(draftKey()) } catch (e) {}
      draftSavedAt.value = ''
      if (limparBanner !== false) { draft.value = null; draftBanner.value = false }
    }

    const readDraft = () => {
      try {
        const bruto = localStorage.getItem(draftKey())
        if (!bruto) return null
        const d = JSON.parse(bruto)
        if (!d || !Array.isArray(d.points)) return null
        const dias = (Date.now() - new Date(d.savedAt || 0).getTime()) / 86400000
        if (dias > DRAFT_MAX_DIAS) { localStorage.removeItem(draftKey()); return null }
        return d
      } catch (e) { return null }
    }

    const draftResumo = computed(() => {
      const d = draft.value
      if (!d) return null
      const total = d.points.length
      const avaliados = d.points.filter(p => p.status).length
      const fotos = d.points.filter(p => p.photoDocId || p.photoUrl).length
      const mesmoTurno = d.auditDate === auditDate.value && d.auditShift === auditShift.value
      return {
        total, avaliados, fotos, mesmoTurno,
        equipe: d.auditedTeam || '—',
        quando: d.auditDate ? fmtDate(d.auditDate) : '',
        turno: d.auditShift || '',
        salvoEm: d.savedAt ? new Date(d.savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
      }
    })

    const applyDraftPoints = (d) => {
      let aplicados = 0
      points.value.forEach(p => {
        const achado = d.points.find(x => x.name === p.name)
        if (!achado) return
        p.status = achado.status || null
        p.reason = achado.reason || ''
        p.photoDocId = achado.photoDocId || ''
        p.photoUrl = achado.photoUrl || ''
        if (p.status || p.photoDocId) aplicados++
      })
      return aplicados
    }

    const resumeDraft = async (silencioso) => {
      const d = draft.value
      if (!d) return
      draftLoading.value = true
      try {
        if (d.auditDate) auditDate.value = d.auditDate
        if (d.auditShift) auditShift.value = d.auditShift
        if (canAuditAny.value) manualAudited.value = d.manualAudited || ''
        if (isAdmin.value && d.adminAuditorTeam) adminAuditorTeam.value = d.adminAuditorTeam
        await nextTick()
        await loadExistingAudit()
        applyDraftPoints(d)
        draftSavedAt.value = d.savedAt || ''
        draftBanner.value = false
        const r = draftResumo.value
        if (!silencioso) showSuccess('Auditoria retomada de onde você parou')
        else if (r) showInfo(`Auditoria em andamento retomada · ${r.avaliados}/${r.total} pontos`)
      } finally {
        draftLoading.value = false
      }
    }

    // Descartar também apaga as fotos que ficariam órfãs no banco
    const discardDraft = async () => {
      const d = draft.value
      if (!d) { clearDraft(); return }
      if (!confirm('Descartar a auditoria em andamento? As fotos já tiradas serão apagadas e o progresso será perdido.')) return
      const ids = d.points.map(p => p.photoDocId).filter(Boolean)
      for (const id of ids) {
        try {
          const snap = await getDoc(doc(db, 'inspection_photos', id))
          // só apaga o que nunca foi vinculado a uma auditoria salva
          if (snap.exists() && !snap.data().auditId) await deleteDoc(doc(db, 'inspection_photos', id))
        } catch (e) { /* segue */ }
      }
      clearDraft()
      buildChecklist()
      showInfo('Rascunho descartado')
    }

    // Decide, ao abrir, se retoma sozinho ou apenas oferece a retomada
    const checkDraft = async () => {
      const d = readDraft()
      if (!d) return
      draft.value = d
      const mesmoContexto = d.auditDate === auditDate.value &&
                            d.auditShift === auditShift.value &&
                            d.auditedTeam === auditedTeam.value
      if (mesmoContexto) await resumeDraft(true)
      else draftBanner.value = true   // é de outro turno: o auditor escolhe
    }

    const loadExistingAudit = async () => {
      if (!pointsConfig.value.length) return
      buildChecklist()
      if (!db || !auditedTeam.value) return
      try {
        const snap = await getDoc(doc(db, 'inspections', auditDocId()))
        if (!snap.exists()) return
        const data = snap.data()
        points.value.forEach(p => {
          const found = (data.points || []).find(sp => sp.name === p.name)
          if (found) {
            p.status = found.status || (found.checked ? 'ok' : null)
            p.reason = found.reason || found.obs || ''
            p.photoUrl = found.photoUrl || ''
            p.photoDocId = found.photoDocId || ''
          }
        })
        showInfo('Auditoria existente carregada para edição')
      } catch (e) { /* nova auditoria */ }
    }

    const markAllOk = () => {
      let marcados = 0, semFoto = 0
      points.value.forEach(p => {
        if (p.status) return
        if (p.photoDocId || p.photoUrl) { p.status = 'ok'; p.reason = ''; marcados++ }
        else semFoto++
      })
      if (marcados) showInfo(`${marcados} ponto(s) marcados como conforme. Ajuste as exceções.`)
      if (semFoto) showWarning(`${semFoto} ponto(s) ainda sem foto do local`)
    }
    const clearAll = () => {
      points.value.forEach(p => { p.status = null; p.reason = '' })
      showErrors.value = false
      clearDraft(false)
    }

    const setStatus = (point, status) => {
      // sem foto do local, não se avalia nada
      if (!(point.photoDocId || point.photoUrl)) {
        showWarning('Anexe a foto do local antes de avaliar este ponto')
        triggerPhoto(point)
        return
      }
      point.status = point.status === status ? null : status
      if (point.status !== 'nok') point.reason = ''
    }

    /* ==================== FOTOS NO FIRESTORE (sem Storage) ==================== */
    /* As imagens são comprimidas e gravadas em documentos próprios da coleção
       `inspection_photos`, uma por documento. A auditoria guarda apenas o id.
       Com o cache persistente do Firestore, a gravação funciona offline e
       sincroniza sozinha quando a rede volta. */
    /* Com foto obrigatória em todos os pontos, o volume salta de ~2 para 16 imagens
       por auditoria. A foto de registro (ponto conforme) é guardada mais leve que a
       evidência de uma não conformidade, que precisa de detalhe para servir de prova. */
    const MAX_FOTO_BYTES = 150 * 1024        // evidência de não conformidade
    const MAX_FOTO_REGISTRO = 70 * 1024      // registro de rotina do local
    const isOnline = ref(navigator.onLine)
    const pendingUploads = ref(0)            // gravações ainda não confirmadas pelo servidor
    const syncing = computed(() => pendingUploads.value > 0)
    const localPhotoUrls = ref({})           // photoDocId -> data URL (cache da sessão)
    const loadingPhoto = ref('')

    const blobToDataUrl = (blob) => new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = rej
      r.readAsDataURL(blob)
    })

    const drawToBlob = (img, maxDim, quality) => new Promise((resolve, reject) => {
      let w = img.width, h = img.height
      if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim }
      else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim }
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      c.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao processar imagem')), 'image/jpeg', quality)
    })

    // Reduz progressivamente até caber no limite do documento
    const compressToTarget = async (file, alvo) => {
      const limite = alvo || MAX_FOTO_BYTES
      const img = await new Promise((res, rej) => {
        const i = new Image(); const u = URL.createObjectURL(file)
        i.onload = () => { URL.revokeObjectURL(u); res(i) }
        i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Imagem inválida')) }
        i.src = u
      })
      const tentativas = [[1024, 0.6], [900, 0.5], [800, 0.45], [720, 0.4], [640, 0.38], [520, 0.33]]
      let blob = null
      for (const [dim, q] of tentativas) {
        blob = await drawToBlob(img, dim, q)
        if (blob.size <= limite) return blob
      }
      return blob
    }

    // Grava a foto. Offline, o Firestore enfileira e envia depois.
    const savePhotoDoc = async (blob, pointName, field) => {
      const dataUrl = await blobToDataUrl(blob)
      const id = 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      localPhotoUrls.value = { ...localPhotoUrls.value, [id]: dataUrl }
      pendingUploads.value++
      setDoc(doc(db, 'inspection_photos', id), {
        data: dataUrl,
        pointName, field: field || 'photo',
        auditId: '',
        by: user.value.uid,
        byName: profile.value?.name || '',
        team: myTeam.value || '',
        bytes: dataUrl.length,
        createdAt: new Date().toISOString()
      }).then(() => { pendingUploads.value = Math.max(0, pendingUploads.value - 1) })
        .catch(e => { pendingUploads.value = Math.max(0, pendingUploads.value - 1); console.error('Foto não gravada:', e) })
      return id
    }

    const linkPhotoToAudit = (photoId, auditId) => {
      if (!photoId || !auditId) return
      pendingUploads.value++
      updateDoc(doc(db, 'inspection_photos', photoId), { auditId })
        .then(() => { pendingUploads.value = Math.max(0, pendingUploads.value - 1) })
        .catch(() => { pendingUploads.value = Math.max(0, pendingUploads.value - 1) })
    }

    const loadPhotoData = async (photoId) => {
      if (!photoId) return ''
      if (localPhotoUrls.value[photoId]) return localPhotoUrls.value[photoId]
      loadingPhoto.value = photoId
      try {
        const snap = await getDoc(doc(db, 'inspection_photos', photoId))
        if (!snap.exists()) { showWarning('Foto não encontrada'); return '' }
        const url = snap.data().data
        localPhotoUrls.value = { ...localPhotoUrls.value, [photoId]: url }
        return url
      } catch (e) {
        showError('Não foi possível carregar a foto' + (navigator.onLine ? '' : ' offline'))
        return ''
      } finally { loadingPhoto.value = '' }
    }

    const syncNow = () => {
      if (!navigator.onLine) { showWarning('Sem conexão. Tudo já está salvo no aparelho e sobe quando a rede voltar.'); return }
      if (pendingUploads.value === 0) showSuccess('Tudo sincronizado')
      else showInfo(`${pendingUploads.value} envio(s) em andamento`)
    }

    window.addEventListener('online', () => { isOnline.value = true; showInfo('Conexão restabelecida. Enviando o que ficou pendente...') })
    window.addEventListener('offline', () => { isOnline.value = false; showWarning('Você está offline. O trabalho continua e sincroniza depois.') })

    /* --- Fotos dos pontos --- */
    const fileInput = ref(null)
    let pendingPhotoPoint = null
    const triggerPhoto = (point) => {
      pendingPhotoPoint = point
      uploadingIndex.value = null
      if (fileInput.value) { fileInput.value.value = ''; fileInput.value.click() }
    }

    const onPhotoSelected = async (ev) => {
      const file = ev.target.files && ev.target.files[0]
      ev.target.value = ''
      const point = pendingPhotoPoint
      pendingPhotoPoint = null
      if (!file || !point) return
      const idx = points.value.indexOf(point)
      uploadingIndex.value = idx
      try {
        const alvo = point.status === 'nok' ? MAX_FOTO_BYTES : MAX_FOTO_REGISTRO
        const blob = await compressToTarget(file, alvo)
        if (blob.size > MAX_FOTO_BYTES * 1.6) { showError('Imagem muito grande mesmo após compressão'); return }
        const id = await savePhotoDoc(blob, point.name, 'photo')
        point.photoDocId = id
        point.photoUrl = ''
        showSuccess(navigator.onLine ? 'Foto anexada' : 'Foto salva no aparelho. Envio automático depois.')
      } catch (e) {
        console.error(e)
        showError('Não foi possível processar a foto: ' + e.message)
      } finally { uploadingIndex.value = null }
    }

    const hasPhoto = (p) => !!(p.photoDocId || p.photoUrl)
    const photoPreview = (p) => p.photoUrl || (p.photoDocId ? localPhotoUrls.value[p.photoDocId] : '')

    const removePhotoFromPoint = async (point) => {
      point.status = null
      point.reason = ''
      if (point.photoDocId) {
        try { await deleteDoc(doc(db, 'inspection_photos', point.photoDocId)) } catch (e) {}
        const copy = { ...localPhotoUrls.value }; delete copy[point.photoDocId]
        localPhotoUrls.value = copy
      }
      point.photoDocId = ''; point.photoUrl = ''; point.photoPath = ''
    }

    /* --- Lightbox --- */
    const lightboxUrl = ref('')
    const openImage = (url) => { if (url) lightboxUrl.value = url }
    const closeImage = () => { lightboxUrl.value = '' }
    // abre uma foto guardada no Firestore, carregando sob demanda
    const openPhotoDoc = async (photoId, fallbackUrl) => {
      if (fallbackUrl) { lightboxUrl.value = fallbackUrl; return }
      const url = await loadPhotoData(photoId)
      if (url) lightboxUrl.value = url
    }

    /* --- Salvar --- */
    const saveAudit = async () => {
      if (!db) { showError('Banco de dados desconectado'); return }
      if (!auditedTeam.value) { showError('Rodízio não configurado para sua equipe'); return }
      if (answeredCount.value < points.value.length) { showWarning('Verifique todos os pontos'); return }
      if (pendingPhotos.value || pendingReasons.value) {
        showErrors.value = true
        showWarning('Complete as não conformidades (motivo e foto)')
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      saving.value = true
      try {
        const payload = {
          team: auditedTeam.value,              // equipe avaliada (compatível com relatórios)
          auditorTeam: auditorTeam.value,       // equipe que auditou
          auditorName: profile.value?.name || user.value.email,
          auditorUid: user.value.uid,
          date: auditDate.value,
          shift: auditShift.value,
          score: progress.value,
          meta: meta.value,
          points: points.value.map(p => ({
            name: p.name,
            area: p.area || 'Geral',
            peso: p.peso || 1,
            status: p.status,
            checked: p.status === 'ok',        // compatibilidade com dados antigos
            reason: p.status === 'nok' ? (p.reason || '').trim() : '',
            obs: p.status === 'nok' ? (p.reason || '').trim() : '',
            photoUrl: p.photoUrl || '',
            photoDocId: p.photoDocId || '',
            treatment: p.status === 'nok' ? { status: 'aberta' } : null
          })),
          acknowledgement: null,
          historico: [{
            at: new Date().toISOString(),
            by: user.value.uid,
            name: profile.value?.name || user.value.email,
            team: auditorTeam.value,
            action: 'Auditoria registrada',
            detail: `${progress.value}% · ${nokCount.value} não conformidade(s)`
          }],
          updatedAt: new Date().toISOString()
        }
        const docId = auditDocId()
        await setDoc(doc(db, 'inspections', docId), payload)
        points.value.forEach(p => { if (p.photoDocId) linkPhotoToAudit(p.photoDocId, docId) })
        clearTimeout(draftTimer)
        clearDraft()
        showSuccess(navigator.onLine ? 'Auditoria registrada com sucesso!' : 'Auditoria salva no aparelho. Será enviada quando a rede voltar.')
        shareFromSave.value = true
        shareData.value = { _id: docId, ...payload }
        loadAlerts()
      } catch (e) {
        console.error(e)
        showError('Erro ao salvar: ' + e.message)
      } finally { saving.value = false }
    }

    /* ==================== AUDITORIAS (recebidas / feitas) ==================== */
    const auditsTab = ref('received')
    const auditsVisible = ref(20)
    const showMoreAudits = () => { auditsVisible.value += 20 }
    const auditsList = ref([])
    const loadingAudits = ref(false)
    const auditsMonth = ref(new Date().toISOString().slice(0, 7))
    const openAudits = ref({})

    const toggleAudit = (id) => { openAudits.value[id] = !openAudits.value[id] }

    const loadAudits = async () => {
      if (!db || !profile.value) return
      loadingAudits.value = true
      auditsList.value = []
      try {
        const start = auditsMonth.value + '-01'
        const end = auditsMonth.value + '-31'
        const field = auditsTab.value === 'received' ? 'team' : 'auditorTeam'
        let list = []
        if (auditsTab.value === 'all') {
          const snap = await getDocs(query(collection(db, 'inspections'), where('date', '>=', start), where('date', '<=', end)))
          snap.forEach(d => list.push({ _id: d.id, ...d.data() }))
        } else {
          const snap = await getDocs(query(collection(db, 'inspections'), where(field, '==', myTeam.value)))
          snap.forEach(d => {
            const data = d.data()
            if (data.date >= start && data.date <= end) list.push({ _id: d.id, ...data })
          })
        }
        list.sort((a, b) => b.date.localeCompare(a.date) || String(a.team).localeCompare(String(b.team)))
        auditsList.value = list
        auditsVisible.value = 20
      } catch (e) {
        console.error(e)
        showError('Erro ao carregar auditorias: ' + e.message)
      } finally { loadingAudits.value = false }
    }

    const auditsPage = computed(() => auditsList.value.slice(0, auditsVisible.value))

    const receivedAverage = computed(() => {
      if (!auditsList.value.length) return 0
      return Math.round(auditsList.value.reduce((s, a) => s + (parseFloat(a.score) || 0), 0) / auditsList.value.length)
    })

    const nonConformities = (item) => (item.points || []).filter(p => p.status === 'nok' || p.checked === false)

    /* ==================== ADMIN: AVALIAÇÕES ==================== */
    const adminTab = ref('audits')
    const adminAudits = ref([])
    const loadingAdminAudits = ref(false)
    const adminMonth = ref(new Date().toISOString().slice(0, 7))

    const loadAdminAudits = async () => {
      if (!db || !isAdmin.value) return
      loadingAdminAudits.value = true
      try {
        const start = adminMonth.value + '-01'
        const end = adminMonth.value + '-31'
        const snap = await getDocs(query(collection(db, 'inspections'), where('date', '>=', start), where('date', '<=', end)))
        const list = []
        snap.forEach(d => list.push({ _id: d.id, ...d.data() }))
        list.sort((a, b) => b.date.localeCompare(a.date) || String(a.team).localeCompare(String(b.team)))
        adminAudits.value = list
      } catch (e) { showError('Erro: ' + e.message) }
      finally { loadingAdminAudits.value = false }
    }

    const editing = ref(null) // cópia da auditoria em edição
    const openEdit = (item) => { editing.value = JSON.parse(JSON.stringify(item)) }
    const closeEdit = () => { editing.value = null }
    const setEditStatus = (p, status) => {
      p.status = p.status === status ? null : status
      p.checked = p.status === 'ok'
      if (p.status !== 'nok') { p.reason = ''; p.obs = '' }
    }
    const saveEdit = async () => {
      const e0 = editing.value
      if (!e0) return
      const bad = (e0.points || []).filter(p => p.status === 'nok' && (p.reason || '').trim().length < 5).length
      if (bad) { showWarning('Descreva o motivo de todas as não conformidades'); return }
      try {
        const original = adminAudits.value.find(a => a._id === e0._id) || {}
        const mudou = []
        ;(e0.points || []).forEach(p => {
          const antes = (original.points || []).find(o => o.name === p.name)
          if (antes && (antes.status || (antes.checked ? 'ok' : null)) !== p.status) {
            mudou.push(`${p.name}: ${antes.status === 'ok' ? 'conforme' : 'não conforme'} → ${p.status === 'ok' ? 'conforme' : 'não conforme'}`)
          }
        })
        const pesoT = e0.points.reduce((t, p) => t + (p.peso || 1), 0)
        const pesoO = e0.points.filter(p => p.status === 'ok').reduce((t, p) => t + (p.peso || 1), 0)
        const novoScore = pesoT ? Math.round(pesoO / pesoT * 100) : 0
        const payload = {
          points: e0.points.map(p => ({ ...p, checked: p.status === 'ok', obs: p.reason || '' })),
          score: novoScore,
          shift: e0.shift || 'Dia',
          date: e0.date,
          updatedAt: new Date().toISOString(),
          editedBy: profile.value?.name || user.value.email,
          historico: arrayUnion(logEntry(
            `Editada pelo admin (${Math.round(original.score ?? novoScore)}% → ${novoScore}%)`,
            mudou.slice(0, 6).join(' · ')
          ))
        }
        await updateDoc(doc(db, 'inspections', e0._id), payload)
        showSuccess('Avaliação atualizada')
        closeEdit()
        loadAdminAudits()
      } catch (err) { showError('Erro ao salvar: ' + err.message) }
    }

    const deleteAudit = async (item) => {
      if (!confirm(`Excluir a auditoria da ${item.team} de ${item.date.split('-').reverse().join('/')} (${item.shift || '-'})?`)) return
      try {
        // apaga as fotos vinculadas para não deixar documento órfão consumindo cota
        const fotos = []
        ;(item.points || []).forEach(p => {
          if (p.photoDocId) fotos.push(p.photoDocId)
          if (p.treatment && p.treatment.afterPhotoDocId) fotos.push(p.treatment.afterPhotoDocId)
        })
        for (const id of fotos) { try { await deleteDoc(doc(db, 'inspection_photos', id)) } catch (e) {} }
        await deleteDoc(doc(db, 'inspections', item._id))
        adminAudits.value = adminAudits.value.filter(a => a._id !== item._id)
        auditsList.value = auditsList.value.filter(a => a._id !== item._id)
        showSuccess('Auditoria excluída')
      } catch (e) { showError('Erro ao excluir: ' + e.message) }
    }

    /* ==================== GALERIA DE FOTOS (ADMIN) ==================== */
    /* Permite ao administrador conferir se o auditor está de fato fotografando
       o local certo, e não repetindo a mesma imagem ou fotografando o chão. */
    const galleryFilter = ref('todas')     // todas | ok | nok | after
    const galleryTeamFilter = ref('todas')
    const galleryVisible = ref(12)
    const loadingGallery = ref(false)

    const galleryAll = computed(() => {
      const rows = []
      adminAudits.value.forEach(a => {
        (a.points || []).forEach(p => {
          const st = p.status || (p.checked ? 'ok' : 'nok')
          if (p.photoDocId || p.photoUrl) {
            rows.push({
              key: a._id + '|' + p.name + '|p',
              photoDocId: p.photoDocId || '', photoUrl: p.photoUrl || '',
              kind: st, name: p.name, area: p.area || 'Geral',
              reason: p.reason || p.obs || '',
              team: a.team, auditorTeam: a.auditorTeam || '—', auditorName: a.auditorName || '',
              date: a.date, shift: a.shift || '-'
            })
          }
          const t = p.treatment
          if (t && (t.afterPhotoDocId || t.afterPhotoUrl)) {
            rows.push({
              key: a._id + '|' + p.name + '|a',
              photoDocId: t.afterPhotoDocId || '', photoUrl: t.afterPhotoUrl || '',
              kind: 'after', name: p.name, area: p.area || 'Geral',
              reason: t.nota || '',
              team: a.team, auditorTeam: a.auditorTeam || '—', auditorName: t.resolvedBy || t.updatedBy || '',
              date: a.date, shift: a.shift || '-'
            })
          }
        })
      })
      return rows.sort((x, y) => y.date.localeCompare(x.date) || x.name.localeCompare(y.name))
    })

    const galleryItems = computed(() => {
      let r = galleryAll.value
      if (galleryFilter.value !== 'todas') r = r.filter(x => x.kind === galleryFilter.value)
      if (galleryTeamFilter.value !== 'todas') r = r.filter(x => x.team === galleryTeamFilter.value)
      return r
    })
    const galleryPage = computed(() => galleryItems.value.slice(0, galleryVisible.value))

    // Carrega as imagens da página atual, uma a uma, para não travar a tela
    const loadGalleryPhotos = async () => {
      loadingGallery.value = true
      try {
        for (const it of galleryPage.value) {
          if (it.photoDocId && !localPhotoUrls.value[it.photoDocId]) {
            await loadPhotoData(it.photoDocId)
          }
        }
      } finally { loadingGallery.value = false }
    }
    const showMoreGallery = async () => {
      galleryVisible.value += 12
      await loadGalleryPhotos()
    }
    const galleryThumb = (it) => it.photoUrl || localPhotoUrls.value[it.photoDocId] || ''

    // Quantas fotos cada auditor registrou no mês — ajuda a ver quem está pulando etapa
    const galleryByAuditor = computed(() => {
      const map = {}
      galleryAll.value.forEach(r => {
        const k = r.auditorName || r.auditorTeam
        if (!map[k]) map[k] = { nome: k, equipe: r.auditorTeam, total: 0 }
        map[k].total++
      })
      return Object.values(map).sort((a, b) => b.total - a.total)
    })

    /* ==================== LIMPEZA DE FOTOS ANTIGAS ==================== */
    /* Com 16 fotos por auditoria o espaço gratuito tem prazo de validade.
       A limpeza apaga as imagens antigas e mantém todo o texto das auditorias. */
    const cleaning = ref(false)
    const cleanupMonths = ref(6)
    const cleanupProgress = ref('')

    const cleanupOldPhotos = async () => {
      const meses = Number(cleanupMonths.value) || 6
      const d = new Date()
      d.setMonth(d.getMonth() - meses)
      const corte = d.toISOString().slice(0, 10)
      if (!confirm(`Apagar as FOTOS das auditorias anteriores a ${corte.split('-').reverse().join('/')}?\n\nOs pontos, motivos, notas e tratativas continuam no histórico. Só as imagens são removidas, e isso não pode ser desfeito.`)) return
      cleaning.value = true
      cleanupProgress.value = 'Procurando auditorias antigas...'
      let apagadas = 0, docs = 0
      try {
        const snap = await getDocs(query(collection(db, 'inspections'), where('date', '<', corte), limit(400)))
        const lista = []
        snap.forEach(x => lista.push({ _id: x.id, ...x.data() }))
        for (const a of lista) {
          const ids = []
          const pts = (a.points || []).map(p => {
            const np = { ...p }
            if (p.photoDocId) { ids.push(p.photoDocId); np.photoDocId = ''; np.photoPurged = true }
            if (p.treatment && p.treatment.afterPhotoDocId) {
              ids.push(p.treatment.afterPhotoDocId)
              np.treatment = { ...p.treatment, afterPhotoDocId: '', afterPhotoPurged: true }
            }
            return np
          })
          if (!ids.length) continue
          for (const id of ids) {
            try { await deleteDoc(doc(db, 'inspection_photos', id)); apagadas++ } catch (e) {}
          }
          await updateDoc(doc(db, 'inspections', a._id), {
            points: pts,
            historico: arrayUnion(logEntry('Fotos removidas na limpeza', `${ids.length} imagem(ns) · corte ${corte}`))
          })
          docs++
          cleanupProgress.value = `${apagadas} foto(s) apagadas em ${docs} auditoria(s)...`
        }
        showSuccess(apagadas ? `${apagadas} foto(s) removidas de ${docs} auditoria(s)` : 'Nenhuma foto antiga encontrada')
      } catch (e) {
        showError('Erro na limpeza: ' + e.message)
      } finally {
        cleaning.value = false
        cleanupProgress.value = ''
      }
    }

    /* ==================== ADMIN: USUÁRIOS ==================== */
    const usersList = ref([])
    const loadingUsers = ref(false)
    const userForm = ref(null)
    const savingUser = ref(false)

    const loadUsers = async () => {
      if (!db) return
      loadingUsers.value = true
      try {
        const snap = await getDocs(collection(db, 'users'))
        const list = []
        snap.forEach(d => list.push({ uid: d.id, ...d.data() }))
        list.sort((a, b) => String(a.team).localeCompare(String(b.team)) || String(a.name).localeCompare(String(b.name)))
        usersList.value = list
      } catch (e) { console.error(e) }
      finally { loadingUsers.value = false }
    }

    const newUser = () => { userForm.value = { uid: null, name: '', email: '', password: '', team: teams.value[0] || '', role: 'auditor' } }
    const editUser = (u) => { userForm.value = { uid: u.uid, name: u.name, email: u.email, password: '', team: u.team, role: u.role } }
    const closeUserForm = () => { userForm.value = null }

    const saveUser = async () => {
      const f = userForm.value
      if (!f) return
      if (!f.name || f.name.trim().length < 2) { showWarning('Informe o nome'); return }
      savingUser.value = true
      try {
        if (f.uid) {
          await updateDoc(doc(db, 'users', f.uid), { name: f.name.trim(), team: f.team, role: f.role })
          showSuccess('Usuário atualizado')
        } else {
          if (!f.email || !f.email.includes('@')) { showWarning('E-mail inválido'); savingUser.value = false; return }
          if (!f.password || f.password.length < 6) { showWarning('A senha precisa de ao menos 6 caracteres'); savingUser.value = false; return }
          const uid = await createUserAsAdmin(f.email.trim(), f.password)
          await setDoc(doc(db, 'users', uid), {
            name: f.name.trim(), email: f.email.trim(), team: f.team, role: f.role,
            mustChangePassword: true, createdAt: new Date().toISOString()
          })
          showSuccess('Usuário cadastrado. Ele definirá a senha definitiva no primeiro acesso.')
        }
        closeUserForm()
        loadUsers()
      } catch (e) {
        showError('Erro: ' + (e.code === 'auth/email-already-in-use' ? 'este e-mail já está cadastrado' : e.message))
      } finally { savingUser.value = false }
    }

    const deleteUser = async (u) => {
      if (u.uid === user.value.uid) { showWarning('Você não pode remover seu próprio usuário'); return }
      if (u.role === 'admin' && usersList.value.filter(x => x.role === 'admin').length <= 1) { showWarning('Mantenha ao menos um administrador'); return }
      if (!confirm(`Remover o acesso de ${u.name}?`)) return
      try {
        await deleteDoc(doc(db, 'users', u.uid))
        usersList.value = usersList.value.filter(x => x.uid !== u.uid)
        showSuccess('Acesso removido. A conta de login continua no Authentication — exclua no console se desejar.')
      } catch (e) { showError('Erro: ' + e.message) }
    }

    const resetPassword = async (email) => {
      try { await sendPasswordResetEmail(auth, email); showSuccess('E-mail de redefinição enviado para ' + email) }
      catch (e) { showError('Erro: ' + e.message) }
    }

    /* ==================== ADMIN: CONFIGURAÇÕES ==================== */
    const savingConfig = ref(false)
    const newTeamName = ref('')

    const addTeam = () => {
      const n = newTeamName.value.trim()
      if (!n) return
      if (teams.value.includes(n)) { showWarning('Equipe já existe'); return }
      teams.value.push(n); newTeamName.value = ''
    }
    const removeTeam = (t) => {
      teams.value = teams.value.filter(x => x !== t)
      delete rotation.value[t]
      Object.keys(rotation.value).forEach(k => { if (rotation.value[k] === t) rotation.value[k] = '' })
    }

    const saveGeneralConfig = async () => {
      savingConfig.value = true
      try {
        await Promise.all([
          setDoc(doc(db, 'config_geral', 'meta_padrao'), { valor: meta.value }),
          setDoc(doc(db, 'config_geral', 'equipes'), { lista: teams.value }),
          setDoc(doc(db, 'config_geral', 'rodizio'), { mapa: rotation.value }),
          setDoc(doc(db, 'config_geral', 'escala'), { ...scale.value })
        ])
        showSuccess('Configurações salvas')
      } catch (e) { showError('Erro ao salvar: ' + e.message) }
      finally { savingConfig.value = false }
    }

    const addPoint = async () => {
      const n = newPointName.value.trim()
      if (!n) return
      try {
        const r = await addDoc(collection(db, 'config_pontos'), { name: n, area: 'Geral', peso: 1, ordem: pointsConfig.value.length + 1 })
        pointsConfig.value.push({ id: r.id, name: n, area: 'Geral', peso: 1, ordem: pointsConfig.value.length + 1 })
        newPointName.value = ''
        showSuccess('Ponto adicionado')
      } catch (e) { showError('Erro: ' + e.message) }
    }
    const deletePoint = async (id) => {
      if (!confirm('Remover este ponto de verificação?')) return
      try {
        await deleteDoc(doc(db, 'config_pontos', id))
        pointsConfig.value = pointsConfig.value.filter(p => p.id !== id)
        showSuccess('Ponto removido')
      } catch (e) { showError('Erro: ' + e.message) }
    }
    const renamePoint = async (p) => {
      try {
        await updateDoc(doc(db, 'config_pontos', p.id), {
          name: p.name, area: (p.area || 'Geral').trim() || 'Geral', peso: p.peso || 1
        })
        showSuccess('Ponto atualizado')
      } catch (e) { showError('Erro: ' + e.message) }
    }

    /* ==================== RELATÓRIOS ==================== */
    const reportType = ref('monthly')
    const reportMonth = ref(new Date().toISOString().slice(0, 7))
    const reportYear = ref(new Date().getFullYear())
    const dailyDate = ref(new Date().toISOString().split('T')[0])
    const loadingReports = ref(false)
    const teamStats = ref([])
    const dailyDataList = ref([])

    const loadReports = async () => {
      if (!db || !user.value) return
      loadingReports.value = true
      teamStats.value = []
      dailyDataList.value = []
      try {
        if (reportType.value === 'monthly') {
          const snap = await getDocs(query(collection(db, 'inspections'),
            where('date', '>=', reportMonth.value + '-01'), where('date', '<=', reportMonth.value + '-31')))
          const stats = {}
          snap.forEach(d => {
            const x = d.data()
            const score = parseFloat(x.score) || 0
            if (!stats[x.team]) stats[x.team] = { total: 0, count: 0, name: x.team }
            stats[x.team].total += score
            stats[x.team].count++
          })
          // mês anterior, para calcular a tendência
          const [ry, rm] = reportMonth.value.split('-').map(Number)
          const prevD = new Date(ry, rm - 2, 1)
          const prevMonth = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0')
          const prevStats = {}
          try {
            const psnap = await getDocs(query(collection(db, 'inspections'),
              where('date', '>=', prevMonth + '-01'), where('date', '<=', prevMonth + '-31')))
            psnap.forEach(d => {
              const x = d.data()
              if (!prevStats[x.team]) prevStats[x.team] = { total: 0, count: 0 }
              prevStats[x.team].total += parseFloat(x.score) || 0
              prevStats[x.team].count++
            })
          } catch (e) { /* sem dados anteriores */ }

          let sorted = Object.values(stats).map(s => {
            const avg = parseFloat((s.total / s.count).toFixed(1))
            const pv = prevStats[s.name]
            const prev = pv && pv.count ? parseFloat((pv.total / pv.count).toFixed(1)) : null
            return {
              name: s.name, average: avg, count: s.count, prev,
              delta: prev == null ? null : parseFloat((avg - prev).toFixed(1))
            }
          }).sort((a, b) => b.average - a.average)
          let rank = 1
          for (let i = 0; i < sorted.length; i++) {
            if (i > 0 && sorted[i].average < sorted[i - 1].average) rank++
            sorted[i].rank = rank
          }
          teamStats.value = sorted
          loadingReports.value = false
          setTimeout(() => renderChart('bar'), 120)
        } else if (reportType.value === 'annual') {
          const snap = await getDocs(query(collection(db, 'inspections'),
            where('date', '>=', reportYear.value + '-01-01'), where('date', '<=', reportYear.value + '-12-31')))
          const raw = []
          snap.forEach(d => raw.push(d.data()))
          const td = {}
          opTeams.value.forEach(t => td[t] = Array.from({ length: 12 }, () => ({ total: 0, count: 0 })))
          raw.forEach(d => {
            if (!td[d.team]) td[d.team] = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }))
            const m = parseInt(d.date.split('-')[1]) - 1
            td[d.team][m].total += parseFloat(d.score) || 0
            td[d.team][m].count++
          })
          teamStats.value = Object.keys(td).map(t => ({
            name: t, data: td[t].map(m => m.count ? parseFloat((m.total / m.count).toFixed(1)) : null)
          }))
          loadingReports.value = false
          setTimeout(() => renderChart('line'), 120)
        } else {
          const snap = await getDocs(query(collection(db, 'inspections'), where('date', '==', dailyDate.value)))
          const list = []
          snap.forEach(d => list.push({ _id: d.id, ...d.data() }))
          list.sort((a, b) => String(a.team).localeCompare(String(b.team)) || String(a.shift).localeCompare(String(b.shift)))
          dailyDataList.value = list
          loadingReports.value = false
          renderDailyCharts()
        }
      } catch (e) { console.error(e); loadingReports.value = false; showError('Erro nos relatórios: ' + e.message) }
    }

    const chartId = (id) => 'dailyChart_' + String(id).replace(/[^a-zA-Z0-9_-]/g, '_')

    const renderDailyCharts = () => {
      nextTick(() => {
        dailyDataList.value.forEach(report => {
          const ctx = document.getElementById(chartId(report._id))
          if (!ctx || !window.Chart) return
          const ex = window.Chart.getChart(ctx)
          if (ex) ex.destroy()
          const ok = (report.points || []).filter(p => p.status === 'ok' || p.checked).length
          const nok = (report.points || []).length - ok
          new window.Chart(ctx, {
            type: 'doughnut',
            data: { datasets: [{ data: [ok, nok], backgroundColor: ['#14b8a6', nok === 0 ? 'transparent' : '#ef4444'], borderWidth: 0, spacing: nok === 0 ? 0 : 4 }] },
            options: { responsive: true, maintainAspectRatio: true, cutout: '76%', plugins: { legend: { display: false } } }
          })
        })
      })
    }

    const renderChart = (type) => {
      const ctx = document.getElementById('mainChart')
      if (!ctx || !window.Chart) return
      const ex = window.Chart.getChart(ctx)
      if (ex) ex.destroy()
      const textColor = isDarkMode.value ? '#a9b8b6' : '#4b5a58'
      const currentMeta = meta.value
      if (type === 'bar') {
        const labels = opTeams.value
        const data = labels.map(t => { const s = teamStats.value.find(x => x.name === t); return s ? s.average : 0 })
        const colors = data.map(v => v >= currentMeta ? '#14b8a6' : '#ef4444')
        new window.Chart(ctx, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label: 'Média (%)', data, backgroundColor: colors, borderRadius: 6, order: 2 },
              { type: 'line', label: `Meta: ${currentMeta}%`, data: labels.map(() => currentMeta), borderColor: isDarkMode.value ? '#fff' : '#334', borderDash: [5, 5], borderWidth: 2, pointRadius: 0, order: 1 }
            ]
          },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { color: textColor } }, x: { ticks: { color: textColor } } }, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
        })
      } else {
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
        const palette = ['#14b8a6', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
        new window.Chart(ctx, {
          type: 'line',
          data: { labels: months, datasets: teamStats.value.map((t, i) => ({ label: t.name, data: t.data, borderColor: palette[i % palette.length], tension: .3, spanGaps: true })) },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { color: textColor } }, x: { ticks: { color: textColor } } }, plugins: { legend: { position: 'bottom', labels: { color: textColor } } } }
        })
      }
    }

    const generatePDF = async () => {
      const el = document.getElementById('reportContent')
      if (!el) return
      try {
        const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: isDarkMode.value ? '#151f1e' : '#ffffff' })
        const imgData = canvas.toDataURL('image/jpeg', 0.85)
        const { jsPDF } = window.jspdf
        const pdf = new jsPDF('p', 'mm', 'a4')
        const w = pdf.internal.pageSize.getWidth()
        const h = (canvas.height * w) / canvas.width
        pdf.addImage(imgData, 'JPEG', 0, 10, w, h)
        pdf.save(`Relatorio_${reportType.value}.pdf`)
        showSuccess('PDF gerado')
      } catch (e) { showError('Erro ao gerar PDF') }
    }

    const takeScreenshot = async () => {
      const el = document.getElementById('reportContent')
      if (!el) return
      try {
        const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: isDarkMode.value ? '#151f1e' : '#ffffff' })
        const link = document.createElement('a')
        link.download = `Print_${reportType.value}.png`
        link.href = canvas.toDataURL('image/png', 0.9)
        link.click()
        showSuccess('Print salvo')
      } catch (e) { showError('Erro ao gerar print') }
    }

    const exportCSV = async () => {
      try {
        const rows = [['Data', 'Turno', 'Equipe auditora', 'Equipe auditada', 'Auditor', 'Score', 'Ponto', 'Status', 'Motivo']]
        const source = adminAudits.value.length ? adminAudits.value : auditsList.value
        source.forEach(a => (a.points || []).forEach(p => rows.push([
          a.date, a.shift || '', a.auditorTeam || '', a.team || '', a.auditorName || '', a.score,
          p.name, (p.status === 'ok' || p.checked) ? 'Conforme' : 'Não conforme', (p.reason || p.obs || '').replace(/\s+/g, ' ')
        ])))
        const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')).join('\r\n')
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `controlpoint_${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a); a.click()
        setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 400)
        showSuccess('CSV exportado')
      } catch (e) { showError('Erro ao exportar') }
    }

    /* ==================== AUTENTICAÇÃO ==================== */
    /* ==================== SENHA: RESET, BLOQUEIO E 1º ACESSO ==================== */
    const authView = ref('login')          // login | forgot | reset
    const resetEmail = ref('')
    const resetSent = ref(false)
    const oobCode = ref('')
    const resetAccount = ref('')
    const newPass = ref('')
    const newPass2 = ref('')
    const savingPass = ref(false)
    const MAX_ATTEMPTS = 4
    const LOCK_MINUTES = 15
    const lockTick = ref(Date.now())
    setInterval(() => { lockTick.value = Date.now() }, 1000)

    const attemptsKey = 'cp_login_attempts'
    const readAttempts = () => { try { return JSON.parse(localStorage.getItem(attemptsKey) || '{}') } catch (e) { return {} } }
    const writeAttempts = (o) => { try { localStorage.setItem(attemptsKey, JSON.stringify(o)) } catch (e) {} }
    const emailKey = () => String(authForm.value.email || '').trim().toLowerCase()

    const lockInfo = computed(() => {
      lockTick.value
      const rec = readAttempts()[emailKey()]
      if (!rec) return { locked: false, left: 0, remaining: MAX_ATTEMPTS }
      if (rec.until && rec.until > Date.now()) {
        return { locked: true, left: Math.ceil((rec.until - Date.now()) / 60000), remaining: 0 }
      }
      return { locked: false, left: 0, remaining: Math.max(0, MAX_ATTEMPTS - (rec.count || 0)) }
    })

    const registerFailure = () => {
      const all = readAttempts()
      const k = emailKey()
      const rec = all[k] || { count: 0, until: 0 }
      if (rec.until && rec.until <= Date.now()) { rec.count = 0; rec.until = 0 }
      rec.count = (rec.count || 0) + 1
      if (rec.count >= MAX_ATTEMPTS) rec.until = Date.now() + LOCK_MINUTES * 60000
      all[k] = rec
      writeAttempts(all)
      return rec
    }
    const clearFailures = () => { const all = readAttempts(); delete all[emailKey()]; writeAttempts(all) }

    // Tela de recuperação: envia o e-mail com o link de redefinição
    const sendReset = async () => {
      const mail = String(resetEmail.value || '').trim()
      if (!mail.includes('@')) { authError.value = 'Informe um e-mail válido'; return }
      loading.value = true
      authError.value = ''
      try {
        await sendPasswordResetEmail(auth, mail)
        resetSent.value = true
      } catch (e) {
        authError.value = e.code === 'auth/user-not-found'
          ? 'Não há conta com este e-mail. Fale com o administrador.'
          : ('Erro: ' + e.message)
      } finally { loading.value = false }
    }

    // O link do e-mail volta para o app com ?mode=resetPassword&oobCode=...
    const checkActionUrl = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const mode = params.get('mode')
        const code = params.get('oobCode')
        if (mode !== 'resetPassword' || !code) return false
        const mail = await verifyPasswordResetCode(auth, code)
        oobCode.value = code
        resetAccount.value = mail
        authView.value = 'reset'
        return true
      } catch (e) {
        authError.value = 'Este link de redefinição expirou ou já foi usado. Solicite um novo.'
        authView.value = 'forgot'
        return false
      }
    }

    const clearUrlParams = () => {
      try { window.history.replaceState({}, '', window.location.pathname) } catch (e) {}
    }

    const submitNewPasswordFromLink = async () => {
      if (newPass.value.length < 6) { authError.value = 'A senha precisa de ao menos 6 caracteres'; return }
      if (newPass.value !== newPass2.value) { authError.value = 'As senhas não conferem'; return }
      savingPass.value = true
      authError.value = ''
      try {
        await confirmPasswordReset(auth, oobCode.value, newPass.value)
        const mail = resetAccount.value
        await signInWithEmailAndPassword(auth, mail, newPass.value)
        const all = readAttempts(); delete all[String(mail).toLowerCase()]; writeAttempts(all)
        newPass.value = ''; newPass2.value = ''; oobCode.value = ''
        authView.value = 'login'
        clearUrlParams()
        showSuccess('Senha redefinida com sucesso!')
      } catch (e) {
        authError.value = 'Não foi possível redefinir: ' + e.message
      } finally { savingPass.value = false }
    }

    // Primeiro acesso: troca obrigatória da senha provisória
    const mustChangePassword = computed(() => !!(profile.value && profile.value.mustChangePassword))

    const submitFirstAccessPassword = async () => {
      if (newPass.value.length < 6) { showWarning('A senha precisa de ao menos 6 caracteres'); return }
      if (newPass.value !== newPass2.value) { showWarning('As senhas não conferem'); return }
      savingPass.value = true
      try {
        await updatePassword(auth.currentUser, newPass.value)
        await updateDoc(doc(db, 'users', user.value.uid), { mustChangePassword: false, passwordChangedAt: new Date().toISOString() })
        profile.value = { ...profile.value, mustChangePassword: false }
        newPass.value = ''; newPass2.value = ''
        showSuccess('Senha definida. Bem-vindo!')
      } catch (e) {
        if (e.code === 'auth/requires-recent-login') {
          showError('Sessão expirada. Entre novamente para definir a senha.')
          await signOut(auth)
        } else { showError('Erro: ' + e.message) }
      } finally { savingPass.value = false }
    }

    const goForgot = () => { authView.value = 'forgot'; resetSent.value = false; authError.value = ''; resetEmail.value = authForm.value.email || '' }
    const goLogin = () => { authView.value = 'login'; authError.value = ''; resetSent.value = false }

    const handleLogin = async () => {
      if (lockInfo.value.locked) {
        authError.value = `Acesso bloqueado por excesso de tentativas. Tente novamente em ${lockInfo.value.left} min ou redefina sua senha.`
        return
      }
      loading.value = true
      authError.value = ''
      try {
        await signInWithEmailAndPassword(auth, authForm.value.email.trim(), authForm.value.password)
        clearFailures()
      } catch (e) {
        const map = {
          'auth/invalid-credential': 'E-mail ou senha incorretos',
          'auth/user-not-found': 'Usuário não encontrado',
          'auth/wrong-password': 'Senha incorreta',
          'auth/too-many-requests': 'Muitas tentativas. Tente novamente em instantes',
          'auth/invalid-email': 'E-mail inválido'
        }
        const base = map[e.code] || ('Erro: ' + e.message)
        if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found') {
          const rec = registerFailure()
          if (rec.until && rec.until > Date.now()) {
            authError.value = `Acesso bloqueado por ${LOCK_MINUTES} minutos após ${MAX_ATTEMPTS} tentativas. Use "Esqueci minha senha" para redefinir.`
          } else {
            const left = Math.max(0, MAX_ATTEMPTS - rec.count)
            authError.value = base + ` — ${left} tentativa${left === 1 ? '' : 's'} restante${left === 1 ? '' : 's'}`
          }
        } else { authError.value = base }
      } finally { loading.value = false }
    }

    const logout = async () => {
      clearSessionHint()
      await signOut(auth)
      profile.value = null
      profileMissing.value = false
    }


    /* Sinalizador leve para a landing saber que existe sessão ativa.
       A sessão de verdade continua sendo a do Firebase Auth (IndexedDB);
       isto aqui é só uma dica para decidir o redirecionamento. */
    const SESSION_HINT = 'cp_last_session'
    const writeSessionHint = (u, prof) => {
      try {
        localStorage.setItem(SESSION_HINT, JSON.stringify({
          uid: u.uid,
          name: (prof && prof.name) || u.email || '',
          team: (prof && prof.team) || '',
          at: Date.now()
        }))
      } catch (e) {}
    }
    const clearSessionHint = () => { try { localStorage.removeItem(SESSION_HINT) } catch (e) {} }

    const loadProfile = async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'users', uid))
        if (snap.exists()) { profile.value = { uid, ...snap.data() }; profileMissing.value = false }
        else { profile.value = null; profileMissing.value = true }
      } catch (e) { profile.value = null; profileMissing.value = true }
    }

    /* ==================== WATCHERS / CICLO ==================== */
    watch(isDarkMode, (v) => {
      document.documentElement.classList.toggle('dark', v)
      localStorage.setItem('darkMode', v)
      if (currentView.value === 'reports' && reportType.value !== 'daily') {
        setTimeout(() => renderChart(reportType.value === 'annual' ? 'line' : 'bar'), 250)
      }
    }, { immediate: true })

    watch(currentView, (v) => {
      if (v === 'audits') loadAudits()
      if (v === 'reports') loadReports()
      if (v === 'admin') { loadAdminAudits(); loadUsers() }
      if (v === 'alerts') loadAlerts()
      if (v === 'audit' && !points.value.length) buildChecklist()
      window.scrollTo({ top: 0 })
    })

    watch([auditsTab, auditsMonth], () => { if (currentView.value === 'audits') loadAudits() })
    watch(adminMonth, () => {
      if (currentView.value !== 'admin') return
      if (adminTab.value === 'audits') loadAdminAudits()
      if (adminTab.value === 'fotos') { galleryVisible.value = 12; loadAdminAudits().then(() => loadGalleryPhotos()) }
    })
    watch(adminTab, (t) => {
      if (t === 'fotos') {
        galleryVisible.value = 12
        if (!adminAudits.value.length) loadAdminAudits().then(() => loadGalleryPhotos())
        else loadGalleryPhotos()
      }
    })
    watch([galleryFilter, galleryTeamFilter], () => {
      galleryVisible.value = 12
      if (adminTab.value === 'fotos') loadGalleryPhotos()
    })
    watch([reportType, reportMonth, reportYear, dailyDate], () => { if (currentView.value === 'reports') loadReports() })
    watch([auditedTeam, auditDate, auditShift], () => {
      if (draftLoading.value) return
      if (user.value && pointsConfig.value.length) loadExistingAudit()
    })

    // Toda alteração na auditoria agenda a gravação do rascunho
    watch(points, () => { if (!draftLoading.value) scheduleDraft() }, { deep: true })
    watch([auditDate, auditShift], () => { if (!draftLoading.value) scheduleDraft() })

    // App indo para o fundo ou sendo fechado: grava na hora
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft() })
    window.addEventListener('pagehide', flushDraft)
    window.addEventListener('beforeunload', flushDraft)

    onMounted(async () => {
      loadVersionInfo()
      if (!auth) { booting.value = false; return }
      const isResetLink = await checkActionUrl()
      if (isResetLink) { booting.value = false }
      onAuthStateChanged(auth, async (u) => {
        if (authView.value === 'reset') { booting.value = false; return }
        user.value = u
        if (u) {
          await loadProfile(u.uid)
          writeSessionHint(u, profile.value)
          if (profile.value) {
            await loadConfig()
            await loadMasterPoints()
            adminAuditorTeam.value = myTeam.value
            if (scale.value.ativo) applyCurrentShift()
            await loadExistingAudit()
            await checkDraft()
            loadAlerts()
          }
        } else {
          profile.value = null
          clearSessionHint()
        }
        booting.value = false
      })
    })

    /* ==================== CENTRAL DE NOTIFICAÇÕES ==================== */
    const alertsAudits = ref([])
    const loadingAlerts = ref(false)
    const alertsTab = ref('pending')
    const ncScope = ref('mine')          // mine = recebidas pela minha equipe | made = reportadas por nós
    const alertsTeamFilter = ref('todas') // usado pelo admin

    const loadAlerts = async () => {
      if (!db || !profile.value) return
      loadingAlerts.value = true
      try {
        const start = addDays(localToday(), -30)
        const snap = await getDocs(query(collection(db, 'inspections'), where('date', '>=', start), limit(500)))
        const list = []
        snap.forEach(d => list.push({ _id: d.id, ...d.data() }))
        list.sort((a, b) => b.date.localeCompare(a.date))
        alertsAudits.value = list
      } catch (e) {
        console.error(e)
        showError('Erro ao carregar notificações: ' + e.message)
      } finally { loadingAlerts.value = false }
    }

    const registeredIds = computed(() => new Set(alertsAudits.value.map(a => `${a.team}|${a.date}|${a.shift}`)))

    // Turnos já encerrados nos últimos 7 dias que ainda não têm auditoria registrada
    const pendingList = computed(() => {
      if (!scale.value.ativo) return []
      const now = Date.now()
      const out = []
      const cs = currentShift()
      let it = prevShift(cs.date, cs.shift)
      for (let i = 0; i < 14; i++) {
        if (shiftEndMs(it.date, it.shift) <= now) {
          const audited = teamFor(it.date, it.shift)
          const nx = nextShift(it.date, it.shift)
          const auditor = teamFor(nx.date, nx.shift)
          const id = `${audited}_${it.date}_${it.shift}`
          if (!registeredIds.value.has(`${audited}|${it.date}|${it.shift}`)) {
            out.push({
              id, date: it.date, shift: it.shift, audited, auditor,
              atrasoH: Math.floor((now - shiftEndMs(it.date, it.shift)) / 3600000)
            })
          }
        }
        it = prevShift(it.date, it.shift)
      }
      return isAdmin.value
        ? (alertsTeamFilter.value === 'todas' ? out : out.filter(p => p.auditor === alertsTeamFilter.value || p.audited === alertsTeamFilter.value))
        : out.filter(p => p.auditor === myTeam.value)
    })

    const ncAll = computed(() => {
      const rows = []
      alertsAudits.value.forEach(a => {
        (a.points || []).forEach(p => {
          if (p.status === 'nok' || (p.status == null && p.checked === false)) {
            rows.push({
              key: a._id + '|' + p.name,
              docId: a._id,
              name: p.name, area: p.area || 'Geral',
              reason: p.reason || p.obs || '', photoUrl: p.photoUrl || '',
              treatment: p.treatment || { status: 'aberta' },
              date: a.date, shift: a.shift || '-', team: a.team,
              auditorTeam: a.auditorTeam || '—', auditorName: a.auditorName || ''
            })
          }
        })
      })
      let filtered = rows
      if (isAdmin.value) {
        if (alertsTeamFilter.value !== 'todas') filtered = rows.filter(r => r.team === alertsTeamFilter.value)
      } else {
        filtered = ncScope.value === 'mine'
          ? rows.filter(r => r.team === myTeam.value)
          : rows.filter(r => r.auditorTeam === myTeam.value)
      }
      return filtered.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
    })

    const ncList = computed(() => {
      const f = ncFilter.value
      if (f === 'todas') return ncAll.value
      if (f === 'atrasada') return ncAll.value.filter(r => isOverdue(r.treatment))
      return ncAll.value.filter(r => (r.treatment?.status || 'aberta') === f)
    })

    const ncRecent = computed(() => {
      const cut = addDays(localToday(), -7)
      return ncList.value.filter(r => r.date >= cut)
    })

    const ncByArea = computed(() => {
      const map = {}
      ncAll.value.forEach(r => { const k = r.area || 'Geral'; map[k] = (map[k] || 0) + 1 })
      return Object.entries(map).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count)
    })

    const ncByPoint = computed(() => {
      const map = {}
      ncList.value.forEach(r => { map[r.name] = (map[r.name] || 0) + 1 })
      return Object.entries(map).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count).slice(0, 5)
    })

    // Mesmo ponto reprovado 3x ou mais na mesma equipe nos últimos 30 dias
    const recurrences = computed(() => {
      const map = {}
      ncAll.value.forEach(r => {
        const k = r.team + '|' + r.name
        if (!map[k]) map[k] = { team: r.team, name: r.name, area: r.area, count: 0, last: r.date, open: 0 }
        map[k].count++
        if (r.date > map[k].last) map[k].last = r.date
        if ((r.treatment?.status || 'aberta') !== 'resolvida') map[k].open++
      })
      return Object.values(map).filter(x => x.count >= 3).sort((a, b) => b.count - a.count)
    })

    const alertsCount = computed(() =>
      pendingList.value.length + ncRecent.value.length + pendingAcks.value.length + recurrences.value.length)

    // Abre a tela de auditoria já posicionada na pendência escolhida
    const auditPending = (p) => {
      auditDate.value = p.date
      auditShift.value = p.shift
      currentView.value = 'audit'
    }

    /* ==================== HISTÓRICO DE ALTERAÇÕES ==================== */
    const logEntry = (action, detail) => ({
      at: new Date().toISOString(),
      by: user.value?.uid || '',
      name: profile.value?.name || user.value?.email || '',
      team: myTeam.value || '',
      action, detail: detail || ''
    })

    /* ==================== CIÊNCIA DA EQUIPE AUDITADA ==================== */
    const ackModal = ref(null)   // { item, decision, comment }

    const ackOf = (item) => (item && item.acknowledgement) || null
    const canAck = (item) => !!item && (isAdmin.value || item.team === myTeam.value)
    const openAck = (item, decision) => { ackModal.value = { item, decision: decision || 'ok', comment: '' } }
    const closeAck = () => { ackModal.value = null }

    const submitAck = async () => {
      const m = ackModal.value
      if (!m) return
      if (m.decision === 'contested' && m.comment.trim().length < 5) {
        showWarning('Descreva o motivo da contestação'); return
      }
      try {
        await updateDoc(doc(db, 'inspections', m.item._id), {
          acknowledgement: {
            status: m.decision,
            by: user.value.uid,
            name: profile.value?.name || user.value.email,
            team: myTeam.value,
            comment: m.comment.trim(),
            at: new Date().toISOString()
          },
          historico: arrayUnion(logEntry(
            m.decision === 'ok' ? 'Ciência registrada' : 'Auditoria contestada',
            m.comment.trim()
          )),
          updatedAt: new Date().toISOString()
        })
        const patch = (list) => list.forEach(a => {
          if (a._id === m.item._id) a.acknowledgement = { status: m.decision, name: profile.value?.name, comment: m.comment.trim(), at: new Date().toISOString() }
        })
        patch(auditsList.value); patch(alertsAudits.value); patch(adminAudits.value)
        showSuccess(m.decision === 'ok' ? 'Ciência registrada' : 'Contestação registrada')
        closeAck()
      } catch (e) { showError('Erro: ' + e.message) }
    }

    // Auditorias recebidas pela minha equipe que ainda não têm ciência
    const pendingAcks = computed(() => alertsAudits.value.filter(a =>
      (isAdmin.value ? true : a.team === myTeam.value) &&
      !(a.acknowledgement && a.acknowledgement.status)
    ).slice(0, 30))

    /* ==================== TRATATIVA DAS NÃO CONFORMIDADES ==================== */
    const treatModal = ref(null)   // { row, status, responsavel, prazo, nota, afterUrl, afterDocId }
    const savingTreat = ref(false)
    const ncFilter = ref('todas')  // todas | aberta | andamento | resolvida | atrasada

    const treatOf = (p) => (p && p.treatment) || { status: 'aberta' }
    const isOverdue = (t) => t && t.status !== 'resolvida' && t.prazo && t.prazo < localToday()

    const openTreat = (row) => {
      const t = row.treatment || {}
      treatModal.value = {
        row,
        status: t.status || 'aberta',
        responsavel: t.responsavel || '',
        prazo: t.prazo || '',
        nota: t.nota || '',
        afterUrl: t.afterPhotoUrl || '',
        afterDocId: t.afterPhotoDocId || ''
      }
    }
    const closeTreat = () => { treatModal.value = null }

    const saveTreat = async () => {
      const m = treatModal.value
      if (!m) return
      if (m.status === 'resolvida' && !m.afterUrl && !m.afterDocId) {
        showWarning('Anexe a foto que comprova a correção'); return
      }
      savingTreat.value = true
      try {
        const ref0 = doc(db, 'inspections', m.row.docId)
        const snap = await getDoc(ref0)
        if (!snap.exists()) throw new Error('Auditoria não encontrada')
        const data = snap.data()
        const treatment = {
          status: m.status,
          responsavel: m.responsavel.trim(),
          prazo: m.prazo || '',
          nota: m.nota.trim(),
          afterPhotoUrl: m.afterUrl || '',
          afterPhotoDocId: m.afterDocId || '',
          updatedAt: new Date().toISOString(),
          updatedBy: profile.value?.name || user.value.email
        }
        if (m.status === 'resolvida') {
          treatment.resolvedAt = new Date().toISOString()
          treatment.resolvedBy = profile.value?.name || user.value.email
        }
        const pts = (data.points || []).map(p => p.name === m.row.name ? { ...p, treatment } : p)
        await updateDoc(ref0, {
          points: pts,
          historico: arrayUnion(logEntry('Tratativa: ' + m.status, m.row.name + (m.nota ? ' — ' + m.nota.trim() : ''))),
          updatedAt: new Date().toISOString()
        })
        if (m.afterDocId) linkPhotoToAudit(m.afterDocId, m.row.docId)
        const local = alertsAudits.value.find(a => a._id === m.row.docId)
        if (local) local.points = pts
        showSuccess('Tratativa atualizada')
        closeTreat()
      } catch (e) { showError('Erro: ' + e.message) }
      finally { savingTreat.value = false }
    }

    const treatStats = computed(() => {
      const s = { aberta: 0, andamento: 0, resolvida: 0, atrasada: 0 }
      ncAll.value.forEach(r => {
        const t = r.treatment || { status: 'aberta' }
        s[t.status || 'aberta'] = (s[t.status || 'aberta'] || 0) + 1
        if (isOverdue(t)) s.atrasada++
      })
      return s
    })

    /* --- Foto da correção (tratativa) --- */
    const afterInput = ref(null)
    const uploadingAfter = ref(false)
    const triggerAfterPhoto = () => { if (afterInput.value) { afterInput.value.value = ''; afterInput.value.click() } }
    const onAfterPhotoSelected = async (ev) => {
      const file = ev.target.files && ev.target.files[0]
      ev.target.value = ''
      if (!file || !treatModal.value) return
      uploadingAfter.value = true
      try {
        const blob = await compressToTarget(file)
        const id = await savePhotoDoc(blob, treatModal.value.row.name, 'after')
        treatModal.value.afterDocId = id
        treatModal.value.afterUrl = ''
        showSuccess(navigator.onLine ? 'Foto da correção anexada' : 'Foto salva. Envio automático depois.')
      } catch (e) { showError('Erro na foto: ' + e.message) }
      finally { uploadingAfter.value = false }
    }

    /* ==================== RELATÓRIO COMPARTILHÁVEL ==================== */
    const shareData = ref(null)   // auditoria concluída, para o modal de compartilhamento

    const buildReportText = (a) => {
      const nc = (a.points || []).filter(p => p.status === 'nok' || (p.status == null && p.checked === false))
      const total = (a.points || []).length
      const ok = total - nc.length
      const atingiu = a.score >= (a.meta || meta.value)
      const L = []
      L.push('*ControlPoint — Auditoria de Turno*')
      L.push('')
      L.push(`*Equipe auditada:* ${a.team}`)
      L.push(`*Auditada por:* ${a.auditorTeam || '—'}${a.auditorName ? ' (' + a.auditorName + ')' : ''}`)
      L.push(`*Data:* ${fmtDate(a.date)} · Turno ${a.shift || '-'}`)
      L.push(`*Conformidade:* ${Math.round(a.score)}% (${ok}/${total}) · Meta ${a.meta || meta.value}% ${atingiu ? '✅' : '⚠️'}`)
      L.push('')
      if (!nc.length) {
        L.push('✅ *Nenhuma não conformidade.* Todos os pontos verificados estão conformes.')
      } else {
        L.push(`❌ *Não conformidades (${nc.length}):*`)
        nc.forEach((p, i) => {
          L.push(`${i + 1}. ${p.name}`)
          if (p.reason || p.obs) L.push(`   _${p.reason || p.obs}_`)
          if (p.photoUrl || p.photoDocId) L.push('   📷 evidência fotográfica registrada no app')
        })
      }
      L.push('')
      L.push('_Registrado pelo ControlPoint_')
      return L.join('\n')
    }

    const shareFromSave = ref(false)
    const auditPDF = async () => {
      const a = shareData.value
      if (!a || !window.jspdf) { showError('Gerador de PDF indisponível'); return }
      // garante que as evidências estejam carregadas para entrar no PDF
      for (const p of (a.points || [])) {
        if (p.photoDocId && !localPhotoUrls.value[p.photoDocId]) { try { await loadPhotoData(p.photoDocId) } catch (e) {} }
      }
      try {
        const { jsPDF } = window.jspdf
        const pdf = new jsPDF('p', 'mm', 'a4')
        const W = pdf.internal.pageSize.getWidth()
        const H = pdf.internal.pageSize.getHeight()
        let y = 16
        const line = (txt, size, style, color) => {
          pdf.setFontSize(size || 10)
          pdf.setFont('helvetica', style || 'normal')
          pdf.setTextColor(...(color || [30, 30, 30]))
          const parts = pdf.splitTextToSize(txt, W - 28)
          parts.forEach(t => {
            if (y > H - 16) { pdf.addPage(); y = 16 }
            pdf.text(t, 14, y); y += (size || 10) * 0.52 + 1.6
          })
        }
        pdf.setFillColor(13, 148, 136); pdf.rect(0, 0, W, 22, 'F')
        pdf.setTextColor(255, 255, 255); pdf.setFontSize(14); pdf.setFont('helvetica', 'bold')
        pdf.text('ControlPoint — Relatório de Auditoria', 14, 14)
        y = 32
        line(`Equipe auditada: ${a.team}`, 11, 'bold')
        line(`Auditada por: ${a.auditorTeam || '—'}${a.auditorName ? ' (' + a.auditorName + ')' : ''}`)
        line(`Data: ${fmtDate(a.date)}   ·   Turno: ${a.shift || '-'}`)
        const atingiu = a.score >= (a.meta || meta.value)
        line(`Conformidade: ${Math.round(a.score)}%  (meta ${a.meta || meta.value}%) — ${atingiu ? 'META ATINGIDA' : 'ABAIXO DA META'}`,
             11, 'bold', atingiu ? [22, 163, 74] : [220, 38, 38])
        y += 3
        const nc = (a.points || []).filter(p => p.status === 'nok' || (p.status == null && p.checked === false))
        line(`Pontos verificados: ${(a.points || []).length}   ·   Não conformidades: ${nc.length}`, 10)
        y += 4
        if (nc.length) {
          line('NÃO CONFORMIDADES', 11, 'bold', [220, 38, 38]); y += 1
          nc.forEach((p, i) => {
            line(`${i + 1}. ${p.name}${p.area ? '  [' + p.area + ']' : ''}`, 10, 'bold')
            if (p.reason || p.obs) line(`    Motivo: ${p.reason || p.obs}`, 9)
            const t = p.treatment
            if (t && t.status) line(`    Tratativa: ${t.status}${t.responsavel ? ' · ' + t.responsavel : ''}${t.prazo ? ' · prazo ' + fmtDate(t.prazo) : ''}`, 9, 'normal', [120, 120, 120])
            const img = p.photoDocId ? localPhotoUrls.value[p.photoDocId] : (p.photoUrl || '')
            if (img && img.indexOf('data:') === 0) {
              if (y > H - 50) { pdf.addPage(); y = 16 }
              try { pdf.addImage(img, 'JPEG', 18, y, 46, 34); y += 37 } catch (er) { /* ignora */ }
            } else if (p.photoDocId || p.photoUrl) {
              line('    (evidência fotográfica registrada no app)', 8, 'italic', [120, 120, 120])
            }
            y += 1.5
          })
        } else {
          line('Nenhuma não conformidade registrada.', 10, 'bold', [22, 163, 74])
        }
        y += 4
        line('PONTOS CONFORMES', 11, 'bold', [22, 163, 74])
        ;(a.points || []).filter(p => p.status === 'ok' || p.checked).forEach(p => line('• ' + p.name, 9))
        if (a.acknowledgement && a.acknowledgement.status) {
          y += 4
          line(`Ciência: ${a.acknowledgement.status === 'ok' ? 'de acordo' : 'contestada'} por ${a.acknowledgement.name || ''}`, 9, 'italic')
          if (a.acknowledgement.comment) line(`    ${a.acknowledgement.comment}`, 9, 'italic')
        }
        pdf.setFontSize(7); pdf.setTextColor(150, 150, 150)
        pdf.text('Gerado pelo ControlPoint em ' + new Date().toLocaleString('pt-BR'), 14, H - 8)
        pdf.save(`Auditoria_${a.team}_${a.date}_${a.shift || ''}.pdf`.replace(/\s+/g, ''))
        showSuccess('PDF gerado')
      } catch (e) { showError('Erro ao gerar PDF: ' + e.message) }
    }

    const openShare = (a) => { shareFromSave.value = false; shareData.value = a }
    const closeShare = () => {
      shareData.value = null
      if (shareFromSave.value) {
        shareFromSave.value = false
        currentView.value = 'audits'
        auditsTab.value = 'made'
        loadAudits()
      }
    }

    const shareNative = async () => {
      const text = buildReportText(shareData.value)
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Auditoria ' + shareData.value.team, text })
        } else {
          await navigator.clipboard.writeText(text)
          showSuccess('Relatório copiado. Cole no aplicativo de mensagens.')
        }
      } catch (e) { if (e.name !== 'AbortError') showError('Não foi possível compartilhar') }
    }

    const shareWhatsApp = () => {
      const text = buildReportText(shareData.value)
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank')
    }

    const copyReport = async () => {
      try {
        await navigator.clipboard.writeText(buildReportText(shareData.value))
        showSuccess('Relatório copiado')
      } catch (e) { showError('Não foi possível copiar') }
    }

    /* ==================== HELPERS DE VIEW ==================== */
    const fmtDate = (iso) => iso ? iso.split('-').reverse().join('/') : '-'
    const initials = (n) => {
      const w = String(n || '?').trim().split(/\s+/)
      return ((w[0] || '?')[0] + (w[1] ? w[1][0] : '')).toUpperCase()
    }
    const toggleDarkMode = () => isDarkMode.value = !isDarkMode.value

    return {
      // geral
      booting, user, profile, profileMissing, authForm, authError, loading,
      isDarkMode, toggleDarkMode, isAdmin, myTeam, currentView, menuItems,
      handleLogin, logout,
      authView, goForgot, goLogin, resetEmail, resetSent, sendReset, resetAccount,
      newPass, newPass2, savingPass, submitNewPasswordFromLink,
      mustChangePassword, submitFirstAccessPassword, lockInfo,
      notifications, removeNotification,
      appVersion, versionStatus, versionInfo,
      // config
      teams, rotation, meta, pointsConfig, newPointName, SHIFTS,
      addPoint, deletePoint, renamePoint, addTeam, removeTeam, newTeamName,
      saveGeneralConfig, savingConfig,
      // auditoria
      auditDate, auditShift, auditorTeam, auditedTeam, adminAuditorTeam,
      points, loadingPoints, saving, showErrors, uploadingIndex,
      okCount, nokCount, answeredCount, progress, pendingPhotos, pendingReasons, canSubmit,
      setStatus, markAllOk, clearAll, triggerPhoto, onPhotoSelected, removePhotoFromPoint, saveAudit, fileInput,
      hasPhoto, photoPreview, pointsGrouped, pesoTotal,
      draft, draftBanner, draftResumo, draftSavedAt, resumeDraft, discardDraft,
      isOnline, pendingUploads, syncing, syncNow, localPhotoUrls, loadingPhoto, openPhotoDoc, loadPhotoData,
      lightboxUrl, openImage, closeImage,
      // auditorias
      auditsTab, auditsList, auditsPage, auditsVisible, showMoreAudits, loadingAudits, auditsMonth, openAudits, toggleAudit,
      receivedAverage, nonConformities, loadAudits,
      // admin
      adminTab, adminAudits, loadingAdminAudits, adminMonth, loadAdminAudits,
      galleryFilter, galleryTeamFilter, galleryItems, galleryPage, galleryVisible,
      loadingGallery, loadGalleryPhotos, showMoreGallery, galleryThumb, galleryByAuditor,
      cleaning, cleanupMonths, cleanupProgress, cleanupOldPhotos,
      editing, openEdit, closeEdit, setEditStatus, saveEdit, deleteAudit,
      usersList, loadingUsers, userForm, savingUser, newUser, editUser, closeUserForm,
      saveUser, deleteUser, resetPassword, loadUsers,
      // relatórios
      reportType, reportMonth, reportYear, dailyDate, loadingReports, teamStats, dailyDataList,
      generatePDF, takeScreenshot, exportCSV,
      // ciência e tratativa
      ackModal, ackOf, canAck, openAck, closeAck, submitAck, pendingAcks,
      treatModal, savingTreat, ncFilter, ncAll, treatStats, treatOf, isOverdue,
      openTreat, closeTreat, saveTreat,
      afterInput, uploadingAfter, triggerAfterPhoto, onAfterPhotoSelected,
      // compartilhamento
      shareData, openShare, closeShare, shareNative, shareWhatsApp, copyReport, buildReportText, auditPDF,
      // equipes
      ADM_TEAM, opTeams, canAuditAny, manualAudited,
      // escala
      scale, shiftNow, scalePreview, applyCurrentShift, scaleMismatch, teamFor,
      // notificações
      alertsAudits, loadingAlerts, alertsTab, ncScope, alertsTeamFilter, loadAlerts,
      pendingList, ncList, ncRecent, ncByPoint, ncByArea, recurrences, alertsCount, auditPending,
      // helpers
      fmtDate, initials, chartId
    }
  }
}).mount('#app')
