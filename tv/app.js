/**
 * Core IPTV Application Logic
 * Clean, modular, and performance-oriented implementation.
 */

const iptvApp = {
    // SHA-256 hash for password "123456"
    // Change this value for a different password.
    ACCESS_HASH: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
    hls: null,
    currentChannels: [],
    allParsedChannels: [],

    /**
     * Authenticates user via crypto subtle API
     */
    async authenticate() {
        const password = document.getElementById('password-input').value;
        const errorEl = document.getElementById('auth-error');

        const hashed = await this._hashString(password);

        if (hashed === this.ACCESS_HASH) {
            document.getElementById('auth-wrapper').classList.add('hidden');
            document.getElementById('app-container').classList.remove('hidden');
            // Auto-load channels on login
            this.loadChannels();
        } else {
            errorEl.classList.remove('hidden');
            document.getElementById('password-input').value = '';
        }
    },

    /**
     * Fetches and parses channels from local JSON
     */
    async loadChannels() {
        const listBtn = document.getElementById('load-channels-btn');
        listBtn.textContent = 'Yükleniyor...';
        listBtn.disabled = true;

        try {
            // Önce yerel channels.json dosyasını oku
            const response = await fetch('channels.json?' + new Date().getTime()); // Cache engelleme
            if (!response.ok) throw new Error('channels.json dosyası bulunamadı. Lütfen dosyanın varlığından emin olun.');

            const sources = await response.json();
            this.allParsedChannels = [];

            for (const source of sources) {
                try {
                    const url = atob(source.url.trim());
                    console.log("Yükleniyor:", url);

                    if (url.toLowerCase().endsWith('.m3u') || url.includes('playlist') || url.includes('.m3u8')) {
                        let m3uContent;
                        try {
                            // Doğrudan çekmeyi dene
                            m3uContent = await this._fetchWithTimeout(url);
                        } catch (e) {
                            console.warn("Doğrudan erişim başarısız, CORS Proxy deneniyor...", e);
                            // Başarısız olursa CORS Proxy kullan (allorigins alternatifi)
                            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                            const proxyResponse = await fetch(proxyUrl);
                            const proxyData = await proxyResponse.json();
                            m3uContent = proxyData.contents;
                        }

                        if (m3uContent) {
                            const parsed = this._parseM3U(m3uContent);
                            this.allParsedChannels.push(...parsed);
                        }
                    } else {
                        this.allParsedChannels.push({ name: source.name, url: url });
                    }
                } catch (sourceError) {
                    console.error("Kaynak işlenirken hata:", source.name, sourceError);
                }
            }

            this._renderList(this.allParsedChannels);
        } catch (error) {
            console.error("Genel Hata:", error);
            if (window.location.protocol === 'file:') {
                alert("HATA: Dosyayı doğrudan açtınız (file://). Lütfen bir yerel sunucu (Live Server) veya GitHub Pages kullanın.");
            } else {
                alert("Hata: " + error.message);
            }
        } finally {
            listBtn.textContent = 'Kanalları Güncelle';
            listBtn.disabled = false;
        }
    },

    /**
     * Simple M3U Parser
     */
    _parseM3U(content) {
        const lines = content.split('\n');
        const channels = [];
        let currentName = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXTINF:')) {
                // Extract name after the last comma
                const parts = line.split(',');
                currentName = parts[parts.length - 1].trim() || 'Adsız Kanal';
            } else if (line.startsWith('http')) {
                channels.push({
                    name: currentName || 'Kanal ' + (channels.length + 1),
                    url: line
                });
                currentName = '';
            }
        }
        return channels;
    },

    async _fetchWithTimeout(url, timeout = 10000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(id);
            return await response.text();
        } catch (e) {
            clearTimeout(id);
            throw e;
        }
    },

    filterChannels() {
        const query = document.getElementById('search-input').value.toLowerCase();
        const filtered = this.allParsedChannels.filter(ch =>
            ch.name.toLowerCase().includes(query)
        );
        this._renderList(filtered);
    },

    /**
     * Renders channel list to DOM
     */
    _renderList(channels) {
        const container = document.getElementById('channel-list');
        container.innerHTML = '';

        if (channels.length === 0) {
            container.innerHTML = '<div class="placeholder">Liste boş.</div>';
            return;
        }

        channels.forEach((channel, index) => {
            const item = document.createElement('div');
            item.className = 'channel-item';
            item.innerHTML = `<strong>${index + 1}.</strong> &nbsp; ${channel.name}`;

            item.onclick = () => {
                // Clear previous active states
                document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');

                // Decode and play
                const decodedUrl = atob(channel.url);
                this._initializePlayer(decodedUrl, channel.name);
            };

            container.appendChild(item);
        });
    },

    /**
     * Player initialization logic with HLS support
     */
    _initializePlayer(url, name) {
        const video = document.getElementById('video-player');
        const nameDisplay = document.getElementById('current-channel-name');
        const statusDisplay = document.getElementById('stream-status');

        nameDisplay.textContent = name;
        statusDisplay.textContent = 'YÜKLENİYOR...';
        statusDisplay.className = 'status-indicator';

        // Clean up previous instance
        if (this.hls) {
            this.hls.destroy();
        }

        if (Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true
            });
            this.hls.loadSource(url);
            this.hls.attachMedia(video);
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                video.play();
                statusDisplay.textContent = 'LIVE';
                statusDisplay.classList.add('online');
            });
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    statusDisplay.textContent = 'HATA';
                    statusDisplay.classList.remove('online');
                }
            });
        }
        // Native HLS (Safari/iOS)
        else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => {
                video.play();
                statusDisplay.textContent = 'LIVE';
                statusDisplay.classList.add('online');
            });
        }
    },

    /**
     * SHA-256 Helper
     */
    async _hashString(str) {
        const msgBuffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
};

// Handle Enter key for login
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !document.getElementById('auth-wrapper').classList.contains('hidden')) {
        iptvApp.authenticate();
    }
});
