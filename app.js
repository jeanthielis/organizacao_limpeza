import { createApp, ref, computed, onMounted, watch, nextTick } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
import {
  db, auth, storage,
  collection, addDoc, getDocs, doc, deleteDoc, query, setDoc, updateDoc,
  where, getDoc, orderBy, limit,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail,
  verifyPasswordResetCode, confirmPasswordReset, updatePassword,
  storageRef, uploadBytes, getDownloadURL,
  createUserAsAdmin
} from './firebase.js?v=3.2.0'

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
    const appVersion = ref('3.2.0')
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
        pointsConfig.value = list
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
    const progress = computed(() => points.value.length ? Math.round(okCount.value / points.value.length * 100) : 0)
    const pendingPhotos = computed(() => points.value.filter(p => p.status === 'nok' && !p.photoUrl).length)
    const pendingReasons = computed(() => points.value.filter(p => p.status === 'nok' && (p.reason || '').trim().length < 5).length)
    const canSubmit = computed(() =>
      points.value.length > 0 && answeredCount.value === points.value.length &&
      !!auditedTeam.value && pendingPhotos.value === 0 && pendingReasons.value === 0
    )

    const auditDocId = () => `${auditedTeam.value}_${auditDate.value}_${auditShift.value}` +
      (auditorTeam.value === ADM_TEAM ? '_ADM' : '')

    const buildChecklist = () => {
      points.value = pointsConfig.value.map(p => ({
        id: p.id, name: p.name, status: null, reason: '', photoUrl: '', photoPath: ''
      }))
      showErrors.value = false
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
            p.photoPath = found.photoPath || ''
          }
        })
        showInfo('Auditoria existente carregada para edição')
      } catch (e) { /* nova auditoria */ }
    }

    const setStatus = (point, status) => {
      point.status = point.status === status ? null : status
      if (point.status !== 'nok') point.reason = ''
    }

    /* --- Fotos --- */
    const fileInput = ref(null)
    let pendingPhotoPoint = null
    const triggerPhoto = (point, index) => {
      pendingPhotoPoint = point
      uploadingIndex.value = null
      if (fileInput.value) { fileInput.value.value = ''; fileInput.value.click() }
    }

    const resizeImage = (file, maxDim = 1280, quality = 0.72) => new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        let w = img.width, h = img.height
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim }
        else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim }
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        URL.revokeObjectURL(url)
        c.toBlob(b => b ? resolve(b) : reject(new Error('Falha ao processar imagem')), 'image/jpeg', quality)
      }
      img.onerror = () => reject(new Error('Imagem inválida'))
      img.src = url
    })

    const onPhotoSelected = async (ev) => {
      const file = ev.target.files && ev.target.files[0]
      ev.target.value = ''
      const point = pendingPhotoPoint
      pendingPhotoPoint = null
      if (!file || !point) return
      if (!storage) { showError('Firebase Storage indisponível'); return }
      const idx = points.value.indexOf(point)
      uploadingIndex.value = idx
      try {
        const blob = await resizeImage(file)
        const path = `inspecoes/${auditDocId()}/${Date.now()}_${idx}.jpg`
        const r = storageRef(storage, path)
        await uploadBytes(r, blob, { contentType: 'image/jpeg' })
        point.photoUrl = await getDownloadURL(r)
        point.photoPath = path
        showSuccess('Foto anexada')
      } catch (e) {
        console.error(e)
        showError('Não foi possível enviar a foto: ' + e.message)
      } finally { uploadingIndex.value = null }
    }

    const removePhoto = (point) => { point.photoUrl = ''; point.photoPath = '' }

    /* --- Lightbox --- */
    const lightboxUrl = ref('')
    const openImage = (url) => { if (url) lightboxUrl.value = url }
    const closeImage = () => { lightboxUrl.value = '' }

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
            status: p.status,
            checked: p.status === 'ok',        // compatibilidade com dados antigos
            reason: p.status === 'nok' ? (p.reason || '').trim() : '',
            obs: p.status === 'nok' ? (p.reason || '').trim() : '',
            photoUrl: p.photoUrl || '',
            photoPath: p.photoPath || ''
          })),
          updatedAt: new Date().toISOString()
        }
        await setDoc(doc(db, 'inspections', auditDocId()), payload)
        showSuccess('Auditoria registrada com sucesso!')
        shareFromSave.value = true
        shareData.value = { _id: auditDocId(), ...payload }
        loadAlerts()
      } catch (e) {
        console.error(e)
        showError('Erro ao salvar: ' + e.message)
      } finally { saving.value = false }
    }

    /* ==================== AUDITORIAS (recebidas / feitas) ==================== */
    const auditsTab = ref('received')
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
      } catch (e) {
        console.error(e)
        showError('Erro ao carregar auditorias: ' + e.message)
      } finally { loadingAudits.value = false }
    }

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
        const total = e0.points.length
        const ok = e0.points.filter(p => p.status === 'ok').length
        const payload = {
          points: e0.points.map(p => ({ ...p, checked: p.status === 'ok', obs: p.reason || '' })),
          score: total ? Math.round(ok / total * 100) : 0,
          shift: e0.shift || 'Dia',
          updatedAt: new Date().toISOString(),
          editedBy: profile.value?.name || user.value.email
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
        await deleteDoc(doc(db, 'inspections', item._id))
        adminAudits.value = adminAudits.value.filter(a => a._id !== item._id)
        auditsList.value = auditsList.value.filter(a => a._id !== item._id)
        showSuccess('Auditoria excluída')
      } catch (e) { showError('Erro ao excluir: ' + e.message) }
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
        const r = await addDoc(collection(db, 'config_pontos'), { name: n, ordem: pointsConfig.value.length + 1 })
        pointsConfig.value.push({ id: r.id, name: n, ordem: pointsConfig.value.length + 1 })
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
      try { await updateDoc(doc(db, 'config_pontos', p.id), { name: p.name }); showSuccess('Ponto atualizado') }
      catch (e) { showError('Erro: ' + e.message) }
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
          let sorted = Object.values(stats).map(s => ({
            name: s.name, average: parseFloat((s.total / s.count).toFixed(1)), count: s.count
          })).sort((a, b) => b.average - a.average)
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

    const logout = async () => { await signOut(auth); profile.value = null; profileMissing.value = false }


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
    watch(adminMonth, () => { if (currentView.value === 'admin' && adminTab.value === 'audits') loadAdminAudits() })
    watch([reportType, reportMonth, reportYear, dailyDate], () => { if (currentView.value === 'reports') loadReports() })
    watch([auditedTeam, auditDate, auditShift], () => { if (user.value && pointsConfig.value.length) loadExistingAudit() })

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
          if (profile.value) {
            await loadConfig()
            await loadMasterPoints()
            adminAuditorTeam.value = myTeam.value
            if (scale.value.ativo) applyCurrentShift()
            await loadExistingAudit()
            loadAlerts()
          }
        } else {
          profile.value = null
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
        const snap = await getDocs(query(collection(db, 'inspections'), where('date', '>=', start)))
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

    const ncList = computed(() => {
      const rows = []
      alertsAudits.value.forEach(a => {
        (a.points || []).forEach(p => {
          if (p.status === 'nok' || (p.status == null && p.checked === false)) {
            rows.push({
              key: a._id + '|' + p.name,
              name: p.name, reason: p.reason || p.obs || '', photoUrl: p.photoUrl || '',
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

    const ncRecent = computed(() => {
      const cut = addDays(localToday(), -7)
      return ncList.value.filter(r => r.date >= cut)
    })

    const ncByPoint = computed(() => {
      const map = {}
      ncList.value.forEach(r => { map[r.name] = (map[r.name] || 0) + 1 })
      return Object.entries(map).map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count).slice(0, 5)
    })

    const alertsCount = computed(() => pendingList.value.length + ncRecent.value.length)

    // Abre a tela de auditoria já posicionada na pendência escolhida
    const auditPending = (p) => {
      auditDate.value = p.date
      auditShift.value = p.shift
      currentView.value = 'audit'
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
          if (p.photoUrl) L.push(`   📷 ${p.photoUrl}`)
        })
      }
      L.push('')
      L.push('_Registrado pelo ControlPoint_')
      return L.join('\n')
    }

    const shareFromSave = ref(false)
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
      setStatus, triggerPhoto, onPhotoSelected, removePhoto, saveAudit, fileInput,
      lightboxUrl, openImage, closeImage,
      // auditorias
      auditsTab, auditsList, loadingAudits, auditsMonth, openAudits, toggleAudit,
      receivedAverage, nonConformities, loadAudits,
      // admin
      adminTab, adminAudits, loadingAdminAudits, adminMonth, loadAdminAudits,
      editing, openEdit, closeEdit, setEditStatus, saveEdit, deleteAudit,
      usersList, loadingUsers, userForm, savingUser, newUser, editUser, closeUserForm,
      saveUser, deleteUser, resetPassword, loadUsers,
      // relatórios
      reportType, reportMonth, reportYear, dailyDate, loadingReports, teamStats, dailyDataList,
      generatePDF, takeScreenshot, exportCSV,
      // compartilhamento
      shareData, openShare, closeShare, shareNative, shareWhatsApp, copyReport, buildReportText,
      // equipes
      ADM_TEAM, opTeams, canAuditAny, manualAudited,
      // escala
      scale, shiftNow, scalePreview, applyCurrentShift, scaleMismatch, teamFor,
      // notificações
      alertsAudits, loadingAlerts, alertsTab, ncScope, alertsTeamFilter, loadAlerts,
      pendingList, ncList, ncRecent, ncByPoint, alertsCount, auditPending,
      // helpers
      fmtDate, initials, chartId
    }
  }
}).mount('#app')
