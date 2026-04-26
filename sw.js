const CACHE_NAME = 'controlpoint-v2';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './firebase.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Instala o Service Worker e coloca arquivos em cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .catch((err) => console.error('Erro ao cachear:', err))
  );
  self.skipWaiting();
});

// Responde com o cache quando offline, ou busca na rede
self.addEventListener('fetch', (event) => {
  try {
    // 🚫 NÃO cachear requisições do Firestore - sempre usar rede
    const url = event.request.url;
    if (url.includes('firestore.googleapis.com') ||
        url.includes('firebase') ||
        url.includes('accounts.google.com') ||
        url.includes('googleapis.com')) {
      // Requisições do Firebase SEMPRE vão para rede
      event.respondWith(
        fetch(event.request)
          .catch(() => new Response('{"error":"offline"}', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'application/json' })
          }))
      );
      return;
    }
    
    // ✅ Para outros arquivos, usar cache-first strategy
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          if (response) return response;
          
          // Se não estiver em cache, buscar na rede
          return fetch(event.request).catch(() => {
            // Se estiver offline e não tiver cache, retornar fallback
            if (event.request.method === 'GET' && 
                event.request.headers.get('accept').includes('text/html')) {
              return caches.match('./index.html');
            }
            return new Response('Offline', { status: 503 });
          });
        })
    );
  } catch (err) {
    console.error('Erro no fetch handler:', err);
    event.respondWith(new Response('Erro no service worker: ' + err.message, { status: 500 }));
  }
});

// Atualiza o cache quando há nova versão
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deletando cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Log para debug
self.addEventListener('message', (event) => {
  console.log('Service Worker message:', event.data);
});
