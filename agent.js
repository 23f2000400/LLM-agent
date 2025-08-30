/**
 * GyaanSetu - Advanced AI Assistant
 * v2.8.0 (Updated: AI Pipe integration + bug fixes)
 * Author: Gaurav Tomar (Original) & Assistant (fixes)
 */
class GyaanSetu {
    constructor() {
        this.version = '2.8.0';
        this.initialized = false;
        this.state = new Proxy({
            conversations: new Map(),
            currentConversationId: null,
            isProcessing: false,
            settings: this.getDefaultSettings(),
            performance: { startTime: Date.now(), responseTime: 0, apiCalls: 0, memoryUsage: 0 },
            ui: { theme: 'auto', sidebarOpen: true, voiceEnabled: false, performanceMonitorOpen: false }
        }, {
            set: (target, property, value) => {
                const oldValue = target[property];
                target[property] = value;
                try { this.onStateChange(property, value, oldValue); } catch(_) {}
                return true;
            }
        });

        this.tools = this.initializeTools();
        this.eventBus = new EventTarget();
        this.cache = new Map();

        this.performanceObserver = null;
        this.memoryMonitor = null;
        this.speechRecognition = null;
        this.speechSynthesis = null;

        this.supportedFileTypes = [
            '.txt', '.json', '.csv', '.md', '.js', '.py', '.html', '.css',
            '.xml', '.yaml', '.yml', '.sql', '.log'
        ];

        // Bind handlers where necessary
        this.debouncedUpdateModelOptions = this.debounce(() => this.updateModelOptions(), 500);

        // init
        this.init();
    }

    async init() {
        try {
            await this.showLoadingScreen();
            await Promise.all([
                this.initializeUI(),
                this.loadSettings(),
                this.initializePerformanceMonitoring(),
                this.initializeVoice(),
                this.loadConversationHistory()
            ]);
            this.setupEventListeners();
            this.setupDragAndDrop();
            this.setupContextMenu();
            this.applySettings();
            this.initialized = true;
            this.hideLoadingScreen();
            this.emit('app:initialized');
            this.showWelcomeMessage();
            console.log(`GyaanSetu v${this.version} initialized successfully`);
        } catch (error) {
            console.error('Failed to initialize GyaanSetu:', error);
            this.showToast('error', 'Initialization Error', `Failed to start the application: ${error.message || error}`);
            try { this.hideLoadingScreen(); } catch(_) {}
        }
    }

    getDefaultSettings() {
        return {
            llm: { provider: 'aipipe', apiKey: '', model: 'default', maxTokens: 2000, temperature: 0.7 },
            ui: { theme: 'auto', animationsEnabled: true, soundEnabled: false, fontSize: 'medium' },
            voice: { enabled: false, outputEnabled: false, language: 'en-US', speechRate: 1.0 },
            advanced: { autoSave: true, analyticsEnabled: false, maxHistory: 100 }
        };
    }

    initializeTools() {
        return [
            { type: "function", function: { name: "web_search", description: "Search the web for current information", parameters: { type: "object", properties: { query: { type: "string" }, results: { type: "integer", default: 5 } }, required: ["query"] } } },
            { type: "function", function: { name: "execute_code", description: "Execute JavaScript code safely", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } } },
            { type: "function", function: { name: "process_file", description: "Process and analyze uploaded files", parameters: { type: "object", properties: { fileId: { type: "string" }, operation: { type: "string", default: "analyze" } }, required: ["fileId"] } } },
            { type: "function", function: { name: "create_visualization", description: "Create data visualizations", parameters: { type: "object", properties: { data: { type: "string" }, type: { type: "string", default: "line" }, title: { type: "string" } }, required: ["data"] } } }
        ];
    }

    // ---------- loading screen ----------
    async showLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        const progressBar = loadingScreen ? loadingScreen.querySelector('.loading-progress') : null;

        if (loadingScreen) {
            loadingScreen.style.display = 'flex';
            loadingScreen.classList.remove('hidden');
        }

        // Simulate progress for UX
        return new Promise(resolve => {
            let progress = 0;
            const interval = setInterval(() => {
                progress += Math.random() * 15;
                if (progressBar) progressBar.style.width = `${Math.min(progress, 100)}%`;
                if (progress >= 100) {
                    progress = 100;
                    clearInterval(interval);
                    setTimeout(resolve, 400);
                }
            }, 90);
        });
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        if (!loadingScreen) return;
        loadingScreen.classList.add('hidden');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 350);
    }

    // ---------- UI initialization ----------
    async initializeUI() {
        // Elements mapping with safe fallbacks
        this.elements = {
            app: document.getElementById('app'),
            sidebar: document.getElementById('sidebar'),
            messagesContainer: document.getElementById('messages-container'),
            messages: document.getElementById('messages'),
            welcomeScreen: document.getElementById('welcome-screen'),
            userInput: document.getElementById('user-input'),
            sendButton: document.getElementById('send-message'),
            settingsModal: document.getElementById('settings-modal'),
            contextMenu: document.getElementById('context-menu'),
            typingIndicator: document.getElementById('typing-indicator'),
            conversationList: document.getElementById('conversation-list'),
            fileDropZone: document.getElementById('file-drop-zone'),
            performanceMonitor: document.getElementById('performance-monitor'),
            charCount: document.getElementById('char-count')
        };

        // marked + highlight integration
        if (window.marked && window.hljs) {
            marked.setOptions({
                highlight: (code, lang) => {
                    try {
                        if (hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
                    } catch (e) {}
                    try { return hljs.highlightAuto(code).value; } catch (e) {}
                    return code;
                },
                breaks: true, gfm: true
            });
        }

        // ensure send button exists for UI state updates
        if (this.elements.sendButton) {
            this.elements.sendButton.disabled = false;
        }

        this.initializeAutoResize();
        this.initializeThemeDetection();

        // make sure model select is populated at startup
        // small delay to ensure DOM inputs are ready
        setTimeout(() => this.updateModelOptions().catch(e => {}), 300);
    }

    initializeAutoResize() {
        const textarea = this.elements.userInput;
        if (textarea) {
            textarea.style.overflow = 'hidden';
            textarea.addEventListener('input', () => {
                textarea.style.height = 'auto';
                textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
                this.updateCharCount();
            });
        }
    }

    initializeThemeDetection() {
        try {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', () => this.updateTheme());
            }
            // apply saved or default immediately
            setTimeout(() => this.updateTheme(), 50);
        } catch (e) {}
    }

    // ---------- performance ----------
    async initializePerformanceMonitoring() {
        try {
            if ('PerformanceObserver' in window) {
                this.performanceObserver = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.entryType === 'measure' && entry.name === 'llm-response') {
                            this.state.performance.responseTime = Math.round(entry.duration);
                            this.updatePerformanceDisplay();
                        }
                    }
                });
                this.performanceObserver.observe({ type: 'measure', buffered: true });
            }
            if (performance && performance.memory) {
                this.memoryMonitor = setInterval(() => {
                    try {
                        this.state.performance.memoryUsage = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
                        this.updatePerformanceDisplay();
                    } catch (e) {}
                }, 5000);
            }
        } catch (error) {
            console.warn('Performance monitoring not available:', error);
        }
    }

    // ---------- voice ----------
    async initializeVoice() {
        try {
            const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
            if (SpeechRecognition) {
                this.speechRecognition = new SpeechRecognition();
                this.speechRecognition.continuous = false;
                this.speechRecognition.interimResults = true;
                this.speechRecognition.onresult = (event) => {
                    const last = event.results[event.results.length - 1];
                    if (last && last.isFinal) {
                        this.elements.userInput.value = last[0].transcript;
                        this.updateCharCount();
                        this.stopVoiceInput();
                    } else if (last) {
                        // show intermediate transcript (optional)
                        // no-op for now
                    }
                };
                this.speechRecognition.onerror = (event) => {
                    console.error('Speech recognition error:', event.error);
                    this.stopVoiceInput();
                    this.showToast('error', 'Voice Error', event.error || 'Unknown error');
                };
            } else {
                // not supported; keep voice controls disabled
            }
        } catch (error) {
            console.warn('Voice capabilities not available:', error);
        }
    }

    // ---------- events ----------
    setupEventListeners() {
        try {
            this.elements.sendButton?.addEventListener('click', () => this.sendMessage());
            this.elements.userInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
            });

            document.getElementById('voice-input')?.addEventListener('click', () => this.toggleVoiceInput());
            document.getElementById('attach-file')?.addEventListener('click', () => document.getElementById('file-input')?.click());
            document.getElementById('file-input')?.addEventListener('change', (e) => this.handleFileSelection(e));
            document.getElementById('voice-toggle')?.addEventListener('click', () => this.toggleVoiceInput());
            document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());
            document.getElementById('fullscreen-toggle')?.addEventListener('click', () => this.toggleFullscreen());
            document.getElementById('settings-toggle')?.addEventListener('click', () => this.openSettings());
            document.getElementById('new-chat')?.addEventListener('click', () => this.createNewConversation());
            document.getElementById('clear-chat')?.addEventListener('click', () => this.clearConversationMessages());
            document.getElementById('export-chat')?.addEventListener('click', () => this.exportConversation());
            document.getElementById('share-chat')?.addEventListener('click', () => this.showToast('info', 'Not Implemented', 'Share feature is coming soon.'));
            document.getElementById('toggle-perf')?.addEventListener('click', () => this.togglePerformanceMonitor());
            document.getElementById('close-settings')?.addEventListener('click', () => this.closeSettings());
            document.getElementById('save-settings')?.addEventListener('click', () => this.saveAndApplySettings());
            document.querySelector('.toggle-visibility')?.addEventListener('click', (e) => this.toggleApiKeyVisibility(e));
            document.getElementById('llm-provider')?.addEventListener('change', () => this.updateModelOptions());
            document.getElementById('api-key')?.addEventListener('input', this.debouncedUpdateModelOptions);
            document.getElementById('clear-all-data')?.addEventListener('click', () => this.clearAllData());
            document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', e => this.switchSettingsTab(e.target.dataset.tab)));
            ['temperature', 'speech-rate'].forEach(id => {
                const input = document.getElementById(id);
                if (input) input.addEventListener('input', () => {
                    const valueSpan = input.parentNode.querySelector('.range-value');
                    if (valueSpan) valueSpan.textContent = id === 'speech-rate' ? `${input.value}x` : input.value;
                });
            });

            // quick-action buttons in welcome screen
            document.querySelectorAll('.quick-action').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const prompt = btn.dataset.prompt || btn.textContent;
                    if (prompt) {
                        this.elements.userInput.value = prompt;
                        this.updateCharCount();
                        this.sendMessage();
                    }
                });
            });

            // character count
            this.elements.userInput?.addEventListener('input', () => this.updateCharCount());

            // context menu actions
            this.elements.contextMenu?.querySelectorAll('.context-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const action = item.dataset.action;
                    this.handleContextAction(action);
                    this.hideContextMenu();
                });
            });
        } catch (e) {
            console.warn('Error wiring event listeners', e);
        }
    }

    // ---------- drag & drop ----------
    setupDragAndDrop() {
        const dropZone = this.elements.fileDropZone;
        const container = this.elements.messagesContainer;
        if (!container) return;
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => container.addEventListener(eventName, this.preventDefaults, false));
        ['dragenter', 'dragover'].forEach(eventName => container.addEventListener(eventName, () => dropZone?.classList.add('active'), false));
        ['dragleave', 'drop'].forEach(eventName => container.addEventListener(eventName, () => dropZone?.classList.remove('active'), false));
        container.addEventListener('drop', e => {
            if (!e.dataTransfer) return;
            this.handleFiles(Array.from(e.dataTransfer.files));
        }, false);

        // click drop zone triggers file input
        dropZone?.addEventListener('click', () => document.getElementById('file-input')?.click());
    }

    // ---------- context menu ----------
    setupContextMenu() {
        if (!this.elements.messages) return;
        this.elements.messages.addEventListener('contextmenu', e => {
            e.preventDefault();
            const messageElement = e.target.closest('.message');
            if (messageElement) this.showContextMenu(e.clientX, e.clientY, messageElement);
        });
        document.addEventListener('click', (e) => {
            // hide when clicking outside
            const menu = this.elements.contextMenu;
            if (!menu) return;
            if (!menu.contains(e.target)) menu.classList.remove('active');
        });
    }

    // ---------- messaging ----------
    async sendMessage() {
        const inputEl = this.elements.userInput;
        const input = inputEl ? inputEl.value.trim() : '';
        if (!input || this.state.isProcessing) return;
        this.state.isProcessing = true;
        this.updateUIState();
        let convId = this.state.currentConversationId || this.createNewConversation();
        this.addMessage('user', input, convId);
        if (inputEl) { inputEl.value = ''; inputEl.style.height = 'auto'; this.updateCharCount(); }
        this.hideWelcomeScreen();
        this.showTypingIndicator();
        try {
            await this.agentLoop(convId);
        } catch (error) {
            console.error('Agent loop error:', error);
            this.addMessage('system', `An error occurred: ${error.message || error}`, convId);
            this.showToast('error', 'Agent Error', error.message || 'Unknown error');
        } finally {
            this.state.isProcessing = false;
            this.updateUIState();
            this.hideTypingIndicator();
            this.saveCurrentConversation();
        }
    }

    async agentLoop(conversationId) {
        const conversation = this.state.conversations.get(conversationId);
        if (!conversation) return;
        let maxTurns = 5;
        // call model once and break if no tools requested, or loop while tool calls are returned
        while (maxTurns-- > 0) {
            // guard: limit number of API calls per iteration
            try {
                const responseData = await this.callLLM(conversation);
                this.state.performance.apiCalls = (this.state.performance.apiCalls || 0) + 1;
                this.updatePerformanceDisplay();

                const response = this.parseAPIResponse(responseData, this.state.settings.llm.provider);
                if (response && response.content) {
                    this.addMessage('assistant', response.content, conversationId);
                }

                // handle tool_calls if provider returns them (best-effort)
                if (response && response.tool_calls && response.tool_calls.length > 0) {
                    this.addMessage('assistant', `Using tools: ${response.tool_calls.map(tc => tc.function.name).join(', ')}`, conversationId);
                    // push tool call object into conversation
                    conversation.messages.push({ role: 'assistant', content: null, tool_calls: response.tool_calls });
                    const toolResults = await Promise.all(response.tool_calls.map(tc => this.executeTool(tc)));
                    toolResults.forEach((result, index) => {
                        conversation.messages.push({
                            role: 'tool',
                            tool_call_id: response.tool_calls[index].id,
                            name: response.tool_calls[index].function.name,
                            content: JSON.stringify(result)
                        });
                        this.addMessage('tool', JSON.stringify(result), conversationId);
                    });
                    // loop again to allow model to consume tool outputs
                } else {
                    // no tools — stop
                    break;
                }
            } catch (err) {
                console.error('Error during agent loop iteration:', err);
                this.addMessage('system', `Agent iteration error: ${err.message || err}`, conversationId);
                break;
            }
        }
    }

    // ---------- LLM calls ----------
    async callLLM(conversation) {
        // Build messages in provider-agnostic shape (OpenAI chat style)
        const messagesForApi = conversation.messages.map(m => {
            // keep tool & system & user & assistant roles
            if (m.role === 'tool') return { role: 'system', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
            return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
        }).filter(m => !!m.content);

        const { provider, apiKey, model, maxTokens, temperature } = this.state.settings.llm || {};
        if (!provider) throw new Error('No LLM provider configured.');

        // Demo mode fallback
        if (!apiKey) {
            // return a local mock response
            return { choices: [{ message: { content: "Demo response: provide an API key in settings to use real models." } }] };
        }

        let apiUrl, headers = { 'Content-Type': 'application/json' }, body;

        switch (provider) {
            case 'openai':
                apiUrl = 'https://api.openai.com/v1/chat/completions';
                headers.Authorization = `Bearer ${apiKey}`;
                body = { model, messages: messagesForApi, max_tokens: maxTokens, temperature };
                break;

            case 'google':
                // maps to Google Generative API
                apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                // google uses API key in query string; keep content
                body = {
                    messages: messagesForApi.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content })),
                    temperature, maxOutputTokens: maxTokens
                };
                break;

            case 'aipipe':
                // AI Pipe acts as a proxy. We'll send to its OpenRouter-compatible endpoint by default.
                // AI Pipe docs: https://aipipe.org/  — supports endpoints like /openrouter/v1/chat/completions and /openai/v1/...
                // We'll prioritize openrouter-style endpoint
                apiUrl = 'https://aipipe.org/openrouter/v1/chat/completions';
                headers.Authorization = `Bearer ${apiKey}`;
                body = {
                    model: model || 'openai/gpt-4o-mini', // fallback
                    messages: messagesForApi.map(m => ({ role: m.role, content: m.content })),
                    max_tokens: maxTokens,
                    temperature
                };
                break;

            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }

        // POST request with retries for transient network errors
        try {
            const resp = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
            if (!resp.ok) {
                // attempt to parse error body
                let errText = `${resp.status} ${resp.statusText}`;
                try { const errJson = await resp.json(); errText = errJson.error?.message || JSON.stringify(errJson); } catch (_) {}
                // throw new Error(`API Error (${resp.status}): ${errText}`);
                throw new Error(`Model not supported for your API key — change model in settings. (Status: ${resp.status}, Details: ${errText})`);

            }
            const data = await resp.json();
            return data;
        } catch (err) {
            // bubble up to caller
            throw new Error(err.message || 'Network error');
        }
    }

    parseAPIResponse(data, provider) {
        try {
            switch (provider) {
                case 'openai':
                case 'aipipe':
                    // OpenAI-style responses (or AI Pipe proxying OpenAI/OpenRouter)
                    if (data.choices && data.choices.length > 0) {
                        return data.choices[0].message || { content: data.choices[0].text || '' };
                    }
                    // openrouter style sometimes returns 'content' or 'candidates'
                    if (data.candidates && data.candidates.length > 0) {
                        const parts = data.candidates[0].content?.parts || data.candidates[0].content || [];
                        const text = Array.isArray(parts) ? parts.map(p => p.text || p).join('') : parts;
                        return { content: text };
                    }
                    return { content: JSON.stringify(data) };
                case 'google':
                    if (data.candidates && data.candidates.length) {
                        return { content: data.candidates[0].content.parts[0].text };
                    }
                    return { content: JSON.stringify(data) };
                default:
                    return { content: "Response format not recognized." };
            }
        } catch (e) {
            console.error("Error parsing API response:", e, data);
            throw new Error("Could not parse the API response.");
        }
    }

    // ---------- tool execution (stubs) ----------
    async executeTool(toolCall) {
        const func = toolCall.function || {};
        const name = func.name || func?.name || 'unknown';
        let args = {};
        try {
            if (toolCall.arguments) {
                args = typeof toolCall.arguments === 'string' ? JSON.parse(toolCall.arguments) : toolCall.arguments;
            }
        } catch (e) { args = {}; }

        this.addMessage('system', `Executing tool: ${name}`, this.state.currentConversationId);
        switch (name) {
            case 'web_search': return await this.executeWebSearch(args);
            case 'execute_code': return await this.executeCode(args);
            case 'process_file': return await this.processFile(args);
            case 'create_visualization': return await this.createVisualization(args);
            default: return { error: `Unknown tool: ${name}` };
        }
    }

    async executeWebSearch({ query, results = 5 }) { return { status: `Simulated search for: ${query}`, items: [] }; }
    async executeCode({ code }) { return { output: `Simulated execution of: ${code}` }; }
    async processFile({ fileId, operation }) { return { result: `Simulated ${operation} on file ${fileId}` }; }
    async createVisualization({ data, type, title }) { return { chartUrl: `Simulated ${type} chart titled "${title}"` }; }

    // ---------- messages in UI ----------
    addMessage(role, content, conversationId) {
        try {
            // ensure conversationId
            const convId = conversationId || this.state.currentConversationId;
            if (!convId) return;
            const conversation = this.state.conversations.get(convId);
            if (!conversation) return;
            if (content === null || content === undefined) return;

            const message = { id: `msg_${Date.now()}`, role, content, timestamp: Date.now() };
            conversation.messages.push(message);

            if (role !== 'system' && typeof content === 'string') {
                conversation.preview = content.substring(0, 100);
                if (!conversation.title || conversation.title === 'New Conversation') conversation.title = content.substring(0, 30) || 'Conversation';
                conversation.updatedAt = Date.now();
                this.updateConversationList();
            }
            this.displayMessage(message);
            this.scrollToBottom();
        } catch (e) {
            console.error('addMessage error', e);
        }
    }

    displayMessage(message) {
        try {
            if (!this.elements.messages) return;
            const messageEl = document.createElement('div');
            messageEl.className = `message ${message.role}`;
            messageEl.dataset.messageId = message.id;

            const senderName = { user: 'You', assistant: 'GyaanSetu', system: 'System', tool: 'Tool' }[message.role] || message.role;
            const avatarIcon = { user: 'fa-user', assistant: 'fa-robot', system: 'fa-cog', tool: 'fa-wrench' }[message.role] || 'fa-comment';

            // If content is a string and marked exists, render markdown
            let processedContent = '';
            if (typeof message.content === 'string' && window.marked) {
                try { processedContent = marked.parse(message.content); } catch (e) { processedContent = `<p>${this.escapeHtml(message.content)}</p>`; }
            } else if (typeof message.content === 'string') {
                processedContent = `<p>${this.escapeHtml(message.content)}</p>`;
            } else {
                processedContent = `<pre><code>${this.escapeHtml(JSON.stringify(message.content, null, 2))}</code></pre>`;
            }

            messageEl.innerHTML = `<div class="message-header"><div class="message-avatar ${message.role}"><i class="fas ${avatarIcon}"></i></div><div class="message-info"><div class="message-sender">${this.escapeHtml(senderName)}</div></div></div><div class="message-content">${processedContent}</div>`;
            this.elements.messages.appendChild(messageEl);

            if (window.hljs) {
                messageEl.querySelectorAll('pre code').forEach(block => {
                    try { hljs.highlightElement(block); } catch (e) {}
                });
            }

        } catch (e) {
            console.error('displayMessage error', e);
        }
    }

    // ---------- conversations ----------
    createNewConversation() {
        const id = `conv_${Date.now()}`;
        const convObj = { id, title: 'New Conversation', messages: [], createdAt: Date.now(), updatedAt: Date.now(), preview: '...' };
        this.state.conversations.set(id, convObj);
        this.loadConversation(id);
        return id;
    }

    loadConversation(id) {
        if (!id) return;
        this.state.currentConversationId = id;
        const conversation = this.state.conversations.get(id);
        if (!this.elements.messages) return;
        this.elements.messages.innerHTML = '';
        if (conversation && conversation.messages && conversation.messages.length) {
            this.hideWelcomeScreen();
            conversation.messages.forEach(msg => this.displayMessage(msg));
        } else {
            this.showWelcomeScreen();
        }
        this.updateConversationList();
        this.updateChatHeader();
    }

    clearConversationMessages() {
        if (!this.state.currentConversationId) return;
        if (!confirm('Clear all messages in this conversation?')) return;
        const conv = this.state.conversations.get(this.state.currentConversationId);
        if (!conv) return;
        conv.messages = [];
        conv.preview = 'Cleared';
        conv.updatedAt = Date.now();
        this.loadConversation(this.state.currentConversationId);
        this.saveCurrentConversation();
    }

    async loadConversationHistory() {
        try {
            const stored = localStorage.getItem('agentflow_conversations');
            if (stored) {
                const parsed = JSON.parse(stored);
                // expect array of [id, conv] entries, or object - handle both
                let entries = [];
                if (Array.isArray(parsed)) entries = parsed;
                else if (typeof parsed === 'object') entries = Object.entries(parsed);
                this.state.conversations = new Map(entries.map(([k, v]) => [k, v]));
                // ensure updatedAt exists
                Array.from(this.state.conversations.values()).forEach(conv => { conv.updatedAt = conv.updatedAt || conv.createdAt || Date.now(); conv.messages = conv.messages || []; });
                const recent = Array.from(this.state.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
                if (recent) this.loadConversation(recent.id); else this.createNewConversation();
            } else {
                this.createNewConversation();
            }
        } catch (e) {
            console.warn('Could not load conversation history, starting fresh.', e);
            this.state.conversations = new Map();
            this.createNewConversation();
        }
    }

    saveCurrentConversation() {
        try {
            if (this.state.settings.advanced.autoSave) {
                // store as array so Map can be reconstructed
                localStorage.setItem('agentflow_conversations', JSON.stringify(Array.from(this.state.conversations.entries())));
            }
        } catch (e) {
            console.warn('Could not save conversation', e);
        }
    }

    // ---------- settings modal ----------
    openSettings() {
        this.populateSettingsForm();
        this.elements.settingsModal?.classList.add('active');
    }

    closeSettings() { this.elements.settingsModal?.classList.remove('active'); }

    populateSettingsForm() {
        const s = this.state.settings || this.getDefaultSettings();
        const llmProv = document.getElementById('llm-provider');
        const apiKeyEl = document.getElementById('api-key');
        const maxTokensEl = document.getElementById('max-tokens');
        const tempEl = document.getElementById('temperature');

        if (llmProv) llmProv.value = s.llm.provider || 'aipipe';
        if (apiKeyEl) apiKeyEl.value = s.llm.apiKey || '';
        if (maxTokensEl) maxTokensEl.value = s.llm.maxTokens || 2000;
        if (tempEl) tempEl.value = s.llm.temperature || 0.7;

        // UI settings
        try {
            document.querySelector(`input[name="theme"][value="${s.ui.theme}"]`).checked = true;
        } catch (e) {}
        document.getElementById('animations-enabled').checked = !!s.ui.animationsEnabled;
        document.getElementById('sound-enabled').checked = !!s.ui.soundEnabled;
        document.getElementById('font-size').value = s.ui.fontSize || 'medium';
        document.getElementById('voice-enabled').checked = !!s.voice.enabled;
        document.getElementById('voice-output-enabled').checked = !!s.voice.outputEnabled;
        document.getElementById('voice-language').value = s.voice.language || 'en-US';
        document.getElementById('speech-rate').value = s.voice.speechRate || 1.0;
        document.getElementById('auto-save').checked = !!s.advanced.autoSave;
        document.getElementById('analytics-enabled').checked = !!s.advanced.analyticsEnabled;
        document.getElementById('max-history').value = s.advanced.maxHistory || 100;

        // Update model options (makes a call to provider)
        this.updateModelOptions().catch(e => {});
    }

    updateSettingsFromForm() {
        const s = this.state.settings || this.getDefaultSettings();
        s.llm.provider = document.getElementById('llm-provider')?.value || s.llm.provider;
        s.llm.apiKey = document.getElementById('api-key')?.value || s.llm.apiKey;
        s.llm.model = document.getElementById('model-name')?.value || s.llm.model;
        s.llm.maxTokens = parseInt(document.getElementById('max-tokens')?.value || s.llm.maxTokens, 10);
        s.llm.temperature = parseFloat(document.getElementById('temperature')?.value || s.llm.temperature);
        s.ui.theme = document.querySelector('input[name="theme"]:checked')?.value || s.ui.theme;
        s.ui.animationsEnabled = document.getElementById('animations-enabled')?.checked;
        s.ui.soundEnabled = document.getElementById('sound-enabled')?.checked;
        s.ui.fontSize = document.getElementById('font-size')?.value || s.ui.fontSize;
        s.voice.enabled = document.getElementById('voice-enabled')?.checked;
        s.voice.outputEnabled = document.getElementById('voice-output-enabled')?.checked;
        s.voice.language = document.getElementById('voice-language')?.value || s.voice.language;
        s.voice.speechRate = parseFloat(document.getElementById('speech-rate')?.value || s.voice.speechRate);
        s.advanced.autoSave = document.getElementById('auto-save')?.checked;
        s.advanced.analyticsEnabled = document.getElementById('analytics-enabled')?.checked;
        s.advanced.maxHistory = parseInt(document.getElementById('max-history')?.value || s.advanced.maxHistory, 10);

        this.state.settings = s;
    }

    saveAndApplySettings() {
        try {
            this.updateSettingsFromForm();
            this.applySettings();
            localStorage.setItem('agentflow_settings', JSON.stringify(this.state.settings));
            this.showToast('success', 'Settings Saved', 'Your settings have been updated.');
            this.closeSettings();
        } catch (e) {
            this.showToast('error', 'Save Failed', e.message || 'Could not save settings');
        }
    }

    applySettings() {
        try {
            this.updateTheme();
            const font = { 'small': '0.875rem', 'medium': '1rem', 'large': '1.125rem' }[this.state.settings.ui.fontSize] || '1rem';
            document.documentElement.style.setProperty('--font-size-base', font);
        } catch (e) {}
    }

    async loadSettings() {
        try {
            const stored = localStorage.getItem('agentflow_settings');
            if (stored) {
                const loaded = JSON.parse(stored);
                this.state.settings = {
                    ...this.getDefaultSettings(),
                    ...loaded,
                    llm: { ...this.getDefaultSettings().llm, ...(loaded.llm || {}) },
                    ui: { ...this.getDefaultSettings().ui, ...(loaded.ui || {}) },
                    voice: { ...this.getDefaultSettings().voice, ...(loaded.voice || {}) },
                    advanced: { ...this.getDefaultSettings().advanced, ...(loaded.advanced || {}) }
                };
            }
        } catch (e) {
            console.warn('Could not load settings, using defaults', e);
        }
    }

    clearAllData() {
        if (confirm('DANGER: This will delete ALL data. Are you sure?')) {
            localStorage.clear();
            window.location.reload();
        }
    }

    // ---------- model list fetching ----------
    async updateModelOptions() {
        const providerEl = document.getElementById('llm-provider');
        const modelSelect = document.getElementById('model-name');
        if (!providerEl || !modelSelect) return;
        const provider = providerEl.value;
        const currentModel = this.state.settings.llm.model || '';
        modelSelect.innerHTML = '<option>Loading...</option>';
        modelSelect.disabled = true;
        try {
            let models = this.cache.get(`models_${provider}`);
            if (!models) {
                switch (provider) {
                    case 'openai': models = await this.fetchOpenAIModels(); break;
                    case 'anthropic': models = await this.fetchAnthropicModels(); break;
                    case 'google': models = await this.fetchGoogleModels(); break;
                    case 'aipipe': models = await this.fetchAIpipeModels(); break;
                    default: models = ['default-local-model'];
                }
                this.cache.set(`models_${provider}`, models);
            }
            modelSelect.innerHTML = '';
            if (!models || !models.length) { modelSelect.innerHTML = '<option>No models found.</option>'; modelSelect.disabled = false; return; }
            models.forEach(modelName => {
                const option = document.createElement('option');
                option.value = modelName;
                option.textContent = modelName;
                modelSelect.appendChild(option);
            });
            if (models.includes(currentModel)) modelSelect.value = currentModel;
            else this.state.settings.llm.model = models[0];
        } catch (error) {
            console.error('updateModelOptions error', error);
            this.showToast('error', `Could not fetch ${provider} models`, 'Check API key or network.');
            modelSelect.innerHTML = `<option value="">API key required to load models.</option>`;
        } finally {
            modelSelect.disabled = false;
        }
    }

    async fetchOpenAIModels() {
        const apiKey = document.getElementById('api-key')?.value;
        if (!apiKey) throw new Error("API Key required for OpenAI");
        const response = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!response.ok) { const err = await response.json().catch(()=>({})); throw new Error(err.error?.message || 'Invalid OpenAI Key'); }
        const data = await response.json();
        return data.data.filter(m => m.id && m.id.includes('gpt')).map(model => model.id).sort().reverse();
    }

    async fetchAnthropicModels() { return ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"]; }

    async fetchGoogleModels() {
        const apiKey = document.getElementById('api-key')?.value;
        if (!apiKey) throw new Error("API Key required for Google");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error?.message || 'Invalid Google Key'); }
        const data = await response.json();
        return (data.models || []).filter(m => (m.supportedGenerationMethods||[]).includes("generateContent")).map(m => m.name.replace('models/', ''));
    }

    // AI Pipe models fetch — attempts to list models via proxy endpoints
    async fetchAIpipeModels() {
        const token = document.getElementById('api-key')?.value;
        if (!token) throw new Error("AI Pipe token required");
        // Try OpenRouter models endpoint first then OpenAI models endpoint
        const candidateSets = [];
        try {
            const r1 = await fetch('https://aipipe.org/openrouter/v1/models', { headers: { Authorization: `Bearer ${token}` } });
            if (r1.ok) {
                const d1 = await r1.json();
                // openrouter style: maybe list models objects
                if (Array.isArray(d1.models)) candidateSets.push(d1.models.map(m => m.name || m.id));
                else if (Array.isArray(d1)) candidateSets.push(d1.map(m=>m.name||m.id));
            }
        } catch (e) {}

        try {
            const r2 = await fetch('https://aipipe.org/openai/v1/models', { headers: { Authorization: `Bearer ${token}` } });
            if (r2.ok) {
                const d2 = await r2.json();
                if (Array.isArray(d2.data)) candidateSets.push(d2.data.map(m=>m.id||m.name));
            }
        } catch (e) {}

        // fallback: return a small curated list if API didn't return models
        const fallback = [
            'openai/gpt-4o-mini', 'openai/gpt-4o', 'openai/gpt-4.1', 'openai/gpt-4o-realtime-preview', 'openai/gpt-3.5-turbo'
        ];

        // combine unique models
        const combined = Array.from(new Set([].concat(...candidateSets.filter(Boolean), fallback)));
        return combined;
    }

    // ---------- conversation list & header ----------
    updateConversationList() {
        try {
            const conversations = Array.from(this.state.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
            if (!this.elements.conversationList) return;
            this.elements.conversationList.innerHTML = conversations.map(conv => `
                <div class="conversation-item ${conv.id === this.state.currentConversationId ? 'active' : ''}" data-conversation-id="${conv.id}">
                    <div class="conversation-title">${this.escapeHtml(conv.title || 'Conversation')}</div>
                    <div class="conversation-preview">${this.escapeHtml(conv.preview || '')}</div>
                </div>`).join('');
            this.elements.conversationList.querySelectorAll('.conversation-item').forEach(item => {
                item.addEventListener('click', () => this.loadConversation(item.dataset.conversationId));
            });
            document.getElementById('total-conversations') && (document.getElementById('total-conversations').textContent = this.state.conversations.size);
            const totalMessages = Array.from(this.state.conversations.values()).reduce((sum, conv) => sum + (conv.messages?.length || 0), 0);
            document.getElementById('total-messages') && (document.getElementById('total-messages').textContent = totalMessages);
        } catch (e) {
            console.warn('updateConversationList error', e);
        }
    }

    updateChatHeader() {
        try {
            const conv = this.state.conversations.get(this.state.currentConversationId);
            if (conv) {
                document.getElementById('chat-title') && (document.getElementById('chat-title').textContent = this.escapeHtml(conv.title || 'Conversation'));
                document.getElementById('chat-description') && (document.getElementById('chat-description').textContent = `Created on ${new Date(conv.createdAt).toLocaleDateString()}`);
            }
        } catch (e) {}
    }

    updateUIState() {
        if (!this.elements.sendButton) return;
        this.elements.sendButton.disabled = this.state.isProcessing;
        this.elements.sendButton.innerHTML = this.state.isProcessing ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-paper-plane"></i>';
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const newTheme = current === 'dark' ? 'light' : 'dark';
        this.state.settings.ui.theme = newTheme;
        this.applySettings();
    }

    updateTheme() {
        const themePref = this.state.settings?.ui?.theme || 'auto';
        const systemTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        const theme = themePref === 'auto' ? systemTheme : themePref;
        document.documentElement.setAttribute('data-theme', theme);
        const icon = document.getElementById('theme-toggle')?.querySelector('i');
        if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }

    toggleApiKeyVisibility(event) {
        try {
            const input = event.currentTarget.previousElementSibling;
            const icon = event.currentTarget.querySelector('i');
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        } catch (e) {}
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => console.error(`Fullscreen error: ${err.message}`));
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }

    toggleVoiceInput() {
        if (!this.speechRecognition) return this.showToast('error', 'Voice Not Supported', 'Browser does not support SpeechRecognition.');
        this.state.ui.voiceEnabled ? this.stopVoiceInput() : this.startVoiceInput();
    }

    startVoiceInput() {
        try {
            this.state.ui.voiceEnabled = true;
            this.speechRecognition.lang = this.state.settings.voice.language || 'en-US';
            this.speechRecognition.start();
            document.querySelectorAll('#voice-toggle, #voice-input').forEach(btn => btn?.classList?.add('active'));
        } catch (e) {
            this.showToast('error', 'Voice Error', e.message || 'Could not start voice input.');
        }
    }

    stopVoiceInput() {
        try {
            this.state.ui.voiceEnabled = false;
            this.speechRecognition?.stop();
            document.querySelectorAll('#voice-toggle, #voice-input').forEach(btn => btn?.classList?.remove('active'));
        } catch (e) {}
    }

    // ---------- utilities ----------
    debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    showTypingIndicator() { this.elements.typingIndicator?.classList.add('active'); }
    hideTypingIndicator() { this.elements.typingIndicator?.classList.remove('active'); }
    showWelcomeScreen() { if (this.elements.welcomeScreen) this.elements.welcomeScreen.style.display = 'flex'; }
    hideWelcomeScreen() { if (this.elements.welcomeScreen) this.elements.welcomeScreen.style.display = 'none'; }

    showWelcomeMessage() {
        const conv = this.state.conversations.get(this.state.currentConversationId);
        if (conv && conv.messages.length === 0) {
            this.addMessage('assistant', 'Welcome to GyaanSetu! How can I assist you?');
        }
    }

    scrollToBottom() {
        try {
            if (!this.elements.messagesContainer) return;
            this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        } catch (e) {}
    }

    escapeHtml(text = '') {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(type, title, message) {
        try {
            const container = document.getElementById('toast-container');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            const icon = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' }[type] || 'fa-info-circle';
            toast.innerHTML = `<div class="toast-icon"><i class="fas ${icon}"></i></div><div class="toast-content"><div class="toast-title">${this.escapeHtml(title)}</div><div class="toast-message">${this.escapeHtml(message)}</div></div><button class="toast-close" aria-label="Close">&times;</button>`;
            toast.querySelector('.toast-close').onclick = () => toast.remove();
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 5000);
        } catch (e) {}
    }

    preventDefaults(e) { try { e.preventDefault(); e.stopPropagation(); } catch (e) {} }

    onStateChange(property, value, oldValue) {
        // optional hook for observability
    }

    emit(eventName, data) { this.eventBus.dispatchEvent(new CustomEvent(eventName, { detail: data })); }

    handleFileSelection(e) { if (!e || !e.target) return; this.handleFiles(Array.from(e.target.files || [])); }

    handleFiles(files) {
        files.forEach(file => {
            if (this.supportedFileTypes.some(type => file.name.toLowerCase().endsWith(type))) {
                const convId = this.state.currentConversationId || this.createNewConversation();
                // Add a system message and store minimal file metadata
                this.addMessage('system', `File uploaded: ${file.name} (size: ${file.size} bytes). Processing placeholder added.`, convId);
                // Optionally store file object in-memory or indexedDB for later processing — omitted for privacy/performance
            } else {
                this.showToast('warning', 'Unsupported File', `${file.name} is not a supported file type.`);
            }
        });
    }

    exportConversation() {
        try {
            const conv = this.state.conversations.get(this.state.currentConversationId);
            if (!conv) return this.showToast('error', 'Export Failed', 'No active conversation.');
            let content = `# ${conv.title}\n\n`;
            conv.messages.forEach(msg => {
                const sender = (msg.role || 'unknown').charAt(0).toUpperCase() + (msg.role || 'unknown').slice(1);
                content += `**${sender}**: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}\n\n`;
            });
            const blob = new Blob([content], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(conv.title || 'conversation').replace(/\s+/g, '_')}.md`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            this.showToast('error', 'Export Failed', e.message || 'Could not export conversation');
        }
    }

    togglePerformanceMonitor() { this.elements.performanceMonitor?.classList.toggle('active'); }

    updatePerformanceDisplay() {
        try {
            document.getElementById('response-time') && (document.getElementById('response-time').textContent = `${this.state.performance.responseTime}ms`);
            document.getElementById('memory-usage') && (document.getElementById('memory-usage').textContent = `${this.state.performance.memoryUsage}MB`);
            document.getElementById('api-calls') && (document.getElementById('api-calls').textContent = this.state.performance.apiCalls || 0);
        } catch (e) {}
    }

    updateCharCount() {
        try {
            const count = this.elements.userInput ? this.elements.userInput.value.length : 0;
            if (this.elements.charCount) this.elements.charCount.textContent = count;
        } catch (e) {}
    }

    switchSettingsTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.toggle('active', content.id === `${tabId}-tab`));
    }

    closeAllModals() { document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active')); }

    hideContextMenu() { this.elements.contextMenu?.classList.remove('active'); }

    showContextMenu(x, y, el) {
        const menu = this.elements.contextMenu;
        if (!menu) return;
        // Populate menu with context-specific actions if needed
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.add('active');
        menu.dataset.messageId = el.dataset.messageId || '';
    }

    handleContextAction(action) {
        const msgId = this.elements.contextMenu?.dataset.messageId;
        if (!msgId) return this.showToast('warning', 'No message selected', '');
        // find message
        const conv = this.state.conversations.get(this.state.currentConversationId);
        if (!conv) return;
        const msg = conv.messages.find(m => m.id === msgId);
        if (!msg) return;
        switch (action) {
            case 'copy':
                navigator.clipboard?.writeText(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
                this.showToast('success', 'Copied', 'Message copied to clipboard.');
                break;
            case 'edit':
                // simple edit: populate input with message text for user to modify and send
                if (typeof msg.content === 'string') {
                    this.elements.userInput.value = msg.content;
                    this.updateCharCount();
                    this.showToast('info', 'Edit', 'Message loaded into input for editing.');
                } else {
                    this.showToast('warning', 'Edit Not Supported', 'Cannot edit structured/tool messages.');
                }
                break;
            case 'delete':
                conv.messages = conv.messages.filter(m => m.id !== msgId);
                this.saveCurrentConversation();
                this.loadConversation(this.state.currentConversationId);
                this.showToast('success', 'Deleted', 'Message deleted.');
                break;
            case 'bookmark':
                msg.bookmarked = true;
                this.showToast('success', 'Bookmarked', 'Message bookmarked.');
                break;
            default:
                this.showToast('info', 'Action', `Action: ${action}`);
        }
    }
}

// initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.agentFlow = new GyaanSetu();
});
