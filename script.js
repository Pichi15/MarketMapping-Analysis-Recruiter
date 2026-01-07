// Global variable to store the current fresh token
let currentTurnstileToken = null;
let currentRequestId = null;  // Track which request owns the lock

// Callback when invisible Turnstile widget completes
window.onTurnstileRefresh = function(token) {
    currentTurnstileToken = token;
    console.log('Turnstile token refreshed');
};

// Function to disable/enable all interactive buttons
function setButtonsEnabled(enabled) {
    // Only disable buttons that trigger network actions.
    // This prevents locking out modal controls like Close.
    const buttons = document.querySelectorAll('button[data-action-button="true"]');
    buttons.forEach(button => {
        button.disabled = !enabled;
        button.style.opacity = enabled ? '1' : '0.5';
        button.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
}

// Function to get a fresh Turnstile token - returns token and requestId for ownership tracking
async function getTurnstileToken() {
    // Check if a request is already in progress
    if (currentRequestId !== null) {
        throw new Error('Please wait for the current request to complete');
    }
    
    // Generate a unique ID for this request to establish ownership
    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    currentRequestId = requestId;
    setButtonsEnabled(false);
    // Reset the current token
    currentTurnstileToken = null;
    
    // Get the Turnstile widget element
    const turnstileElement = document.querySelector('.cf-turnstile');
    if (!turnstileElement) {
        throw new Error('Turnstile widget not found');
    }
    
    // Execute the widget to get a new token
    if (window.turnstile) {
        window.turnstile.reset();
        window.turnstile.execute();
    }
    
    // Wait for the token to be generated (max 10 seconds)
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 100; // 10 seconds (100 * 100ms)
        
        const checkToken = setInterval(() => {
            attempts++;
            if (currentTurnstileToken) {
                clearInterval(checkToken);
                // Return both token and requestId so only the owner can release the lock
                resolve({ token: currentTurnstileToken, requestId: requestId });
            } else if (attempts >= maxAttempts) {
                clearInterval(checkToken);
                // Re-enable buttons on timeout - only if we still own the lock
                if (currentRequestId === requestId) {
                    currentRequestId = null;
                    setButtonsEnabled(true);
                }
                reject(new Error('Turnstile verification timeout'));
            }
        }, 100);
    });
}

// Function to mark request as complete and re-enable buttons
// Only releases the lock if the caller owns it (matching requestId)
function completeRequest(requestId) {
    if (currentRequestId === requestId) {
        currentRequestId = null;
        setButtonsEnabled(true);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize icons
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    // --- Health Check ---
    try {
        const response = await fetch('/api/health');
        if (!response.ok) {
            throw new Error('Server health check failed.');
        }
        const data = await response.json();
        console.log('Server Health:', data.message);
    } catch (error) {
        console.error('Failed to connect to the backend server:', error);
        // Optionally, display an error message on the page
        const body = document.querySelector('body');
        const errorDiv = document.createElement('div');
        errorDiv.textContent = 'Error: Could not connect to the backend server. Please ensure the server is running.';
        errorDiv.style.backgroundColor = 'red';
        errorDiv.style.color = 'white';
        errorDiv.style.padding = '1rem';
        errorDiv.style.textAlign = 'center';
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '0';
        errorDiv.style.width = '100%';
        body.prepend(errorDiv);
    }

    // --- Modal UI Wiring ---
    const modalOverlay = document.getElementById('ai-modal');
    const closeModalBtn = document.getElementById('close-modal');
    const openOutreachBtn = document.getElementById('open-outreach');
    const openIntelBtn = document.getElementById('open-intel');
    const toolOutreach = document.getElementById('tool-outreach');
    const toolChat = document.getElementById('tool-chat');
    const modalTitle = document.getElementById('ai-modal-title');
    const modalIcon = document.getElementById('ai-modal-icon');

    const openModal = (tool) => {
        if (!modalOverlay) return;
        modalOverlay.classList.add('open');
        modalOverlay.setAttribute('aria-hidden', 'false');

        if (tool === 'outreach') {
            toolOutreach?.classList.add('active');
            toolChat?.classList.remove('active');
            if (modalTitle) modalTitle.textContent = 'Character-First Outreach';
            if (modalIcon) modalIcon.setAttribute('data-lucide', 'user-plus');
        } else {
            toolChat?.classList.add('active');
            toolOutreach?.classList.remove('active');
            if (modalTitle) modalTitle.textContent = '2026 Market Intelligence';
            if (modalIcon) modalIcon.setAttribute('data-lucide', 'brain-circuit');
        }

        // Re-create icons after swapping data-lucide
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    };

    const closeModal = () => {
        if (!modalOverlay) return;
        modalOverlay.classList.remove('open');
        modalOverlay.setAttribute('aria-hidden', 'true');
    };

    openOutreachBtn?.addEventListener('click', () => openModal('outreach'));
    openIntelBtn?.addEventListener('click', () => openModal('chat'));
    closeModalBtn?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', (e) => {
        // close when clicking the dark overlay but not when clicking inside modal
        if (e.target === modalOverlay) closeModal();
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // --- Forensic Outreach Generator ---
    const outreachOutput = document.getElementById('outreach-output');
    const outreachOutputText = document.getElementById('outreach-output-text');
    const generateBtn = document.getElementById('generate-outreach-btn');

    const textInput = document.getElementById('candidate-profile-text');
    const fileInput = document.getElementById('resume-file-input');
    const urlInput = document.getElementById('profile-url-input');

    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let activeTab = 'text';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            tabContents.forEach(content => {
                content.classList.add('hidden');
            });
            const next = document.getElementById(`${tabName}-input-tab`);
            next?.classList.remove('hidden');
            
            activeTab = tabName;
        });
    });

    const setOutreachOutput = (text) => {
        if (!outreachOutput || !outreachOutputText) return;
        outreachOutput.style.display = 'block';
        outreachOutputText.textContent = text;
    };

    const clearOutreachOutput = () => {
        if (!outreachOutput || !outreachOutputText) return;
        outreachOutputText.textContent = '';
        outreachOutput.style.display = 'none';
    };

    // URL allowlist validation to reduce SSRF / malicious input patterns
    const isAllowedProfileUrl = (value) => {
        if (!value) return false;
        if (value.length > 2048) return false;
        let url;
        try {
            url = new URL(value);
        } catch {
            return false;
        }
        if (url.protocol !== 'https:') return false;
        // allowlist common profile domains; can be expanded later
        const allowedHosts = new Set([
            'www.linkedin.com',
            'linkedin.com'
        ]);
        return allowedHosts.has(url.hostname);
    };

    // Helper function to convert file to base64
    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = (error) => reject(error);
        });
    };

    generateBtn.addEventListener('click', async () => {
        clearOutreachOutput();
        setOutreachOutput('Generating message...');
        let endpoint = '';
        let body;
        let headers = { 'Content-Type': 'application/json' };

        try {
            if (activeTab === 'text') {
                const profileText = textInput.value;
                if (!profileText.trim()) {
                    setOutreachOutput('Please paste a candidate profile first.');
                    return;
                }
                if (profileText.length > 20000) {
                    setOutreachOutput('Profile text is too long (max 20,000 characters).');
                    return;
                }
                endpoint = '/api/generate-outreach-text';
                body = JSON.stringify({ candidateProfile: profileText });
            
            } else if (activeTab === 'file') {
                const file = fileInput.files[0];
                if (!file) {
                    setOutreachOutput('Please select a resume file first.');
                    return;
                }
                
                // Check file type
                if (file.type !== 'application/pdf') {
                    setOutreachOutput('Please upload a PDF file.');
                    return;
                }

                // Basic size limit (client-side) - helps prevent giant uploads
                const maxBytes = 5 * 1024 * 1024; // 5MB
                if (file.size > maxBytes) {
                    setOutreachOutput('PDF is too large. Please upload a PDF ≤ 5MB.');
                    return;
                }

                // Convert PDF to base64
                setOutreachOutput('Reading file...');
                const pdfBase64 = await fileToBase64(file);
                
                endpoint = '/api/generate-outreach-file';
                body = JSON.stringify({ 
                    pdfBase64: pdfBase64,
                    fileName: file.name 
                });

            } else if (activeTab === 'url') {
                const profileUrl = urlInput.value;
                if (!profileUrl.trim()) {
                    setOutreachOutput('Please enter a profile URL first.');
                    return;
                }

                if (!isAllowedProfileUrl(profileUrl.trim())) {
                    setOutreachOutput('Please provide a valid https:// LinkedIn profile URL.');
                    return;
                }
                endpoint = '/api/generate-outreach-url';
                body = JSON.stringify({ profileUrl: profileUrl.trim() });
            }

            // Get Turnstile token - returns { token, requestId } for ownership tracking
            let token, requestId;
            try {
                const result = await getTurnstileToken();
                token = result.token;
                requestId = result.requestId;
            } catch (error) {
                setOutreachOutput(error.message || 'Security verification failed. Please refresh the page.');
                return;
            }

            // Add Turnstile token to headers
            headers['CF-Turnstile-Token'] = token;

            setOutreachOutput('Generating message...');
            try {
                const response = await fetch(endpoint, { method: 'POST', headers, body });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to get a response from the server.');
                }

                const data = await response.json();
                setOutreachOutput(data.outreachMessage);
            } finally {
                // Re-enable buttons after request completes - only if we own the lock
                completeRequest(requestId);
            }

        } catch (error) {
            console.error('Error:', error);
            setOutreachOutput(`An error occurred: ${error.message}`);
        }
    });


    // --- Market Intelligence Chat ---
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');

    const addMessage = (text, sender) => {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('chat-message', `${sender}-message`);
        messageDiv.textContent = text;
        chatBody.appendChild(messageDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    };
    
    const handleChatSend = async () => {
        const query = chatInput.value;
        if (!query.trim()) return;
        if (query.length > 800) {
            addMessage('Please keep questions under 800 characters.', 'assistant');
            return;
        }

        addMessage(query, 'user');
        chatInput.value = '';
        addMessage("Thinking...", 'assistant-loading');

        // Get Turnstile token - returns { token, requestId } for ownership tracking
        let token, requestId;
        try {
            const result = await getTurnstileToken();
            token = result.token;
            requestId = result.requestId;
        } catch (error) {
            // Remove the "Thinking..." message
            chatBody.removeChild(chatBody.lastChild);
            addMessage(error.message || 'Security verification failed. Please refresh the page.', 'assistant');
            return;
        }

        try {
            const response = await fetch('/api/market-chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'CF-Turnstile-Token': token
                },
                body: JSON.stringify({ query: query })
            });
            
            // Remove the "Thinking..." message
            chatBody.removeChild(chatBody.lastChild);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to get market intelligence response.');
            }

            const data = await response.json();
            addMessage(data.chatResponse, 'assistant');

        } catch (error) {
            console.error('Error:', error);
            addMessage(`Sorry, an error occurred: ${error.message}`, 'assistant');
        } finally {
            // Re-enable buttons after request completes - only if we own the lock
            completeRequest(requestId);
        }
    };

    sendChatBtn.addEventListener('click', handleChatSend);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleChatSend();
        }
    });
});
