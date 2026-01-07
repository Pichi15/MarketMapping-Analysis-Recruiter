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
    const buttons = document.querySelectorAll('button');
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

    // --- Forensic Outreach Generator ---
    const outreachOutput = document.getElementById('outreach-output');
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
                content.classList.remove('active');
            });
            document.getElementById(`${tabName}-input-tab`).classList.add('active');
            
            activeTab = tabName;
        });
    });

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
        outreachOutput.textContent = 'Generating message...';
        let endpoint = '';
        let body;
        let headers = { 'Content-Type': 'application/json' };

        try {
            if (activeTab === 'text') {
                const profileText = textInput.value;
                if (!profileText.trim()) {
                    outreachOutput.textContent = 'Please paste a candidate profile first.';
                    return;
                }
                endpoint = '/api/generate-outreach-text';
                body = JSON.stringify({ candidateProfile: profileText });
            
            } else if (activeTab === 'file') {
                const file = fileInput.files[0];
                if (!file) {
                    outreachOutput.textContent = 'Please select a resume file first.';
                    return;
                }
                
                // Check file type
                if (file.type !== 'application/pdf') {
                    outreachOutput.textContent = 'Please upload a PDF file.';
                    return;
                }

                // Convert PDF to base64
                outreachOutput.textContent = 'Reading file...';
                const pdfBase64 = await fileToBase64(file);
                
                endpoint = '/api/generate-outreach-file';
                body = JSON.stringify({ 
                    pdfBase64: pdfBase64,
                    fileName: file.name 
                });

            } else if (activeTab === 'url') {
                const profileUrl = urlInput.value;
                if (!profileUrl.trim()) {
                    outreachOutput.textContent = 'Please enter a profile URL first.';
                    return;
                }
                endpoint = '/api/generate-outreach-url';
                body = JSON.stringify({ profileUrl });
            }

            // Get Turnstile token - returns { token, requestId } for ownership tracking
            let token, requestId;
            try {
                const result = await getTurnstileToken();
                token = result.token;
                requestId = result.requestId;
            } catch (error) {
                outreachOutput.textContent = error.message || 'Security verification failed. Please refresh the page.';
                return;
            }

            // Add Turnstile token to headers
            headers['CF-Turnstile-Token'] = token;

            outreachOutput.textContent = 'Generating message...';
            try {
                const response = await fetch(endpoint, { method: 'POST', headers, body });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to get a response from the server.');
                }

                const data = await response.json();
                outreachOutput.textContent = data.outreachMessage;
            } finally {
                // Re-enable buttons after request completes - only if we own the lock
                completeRequest(requestId);
            }

        } catch (error) {
            console.error('Error:', error);
            outreachOutput.textContent = `An error occurred: ${error.message}`;
        }
    });


    // --- Market Intelligence Chat ---
    const chatHeader = document.getElementById('chat-header');
    const chatWidget = document.getElementById('market-chat-widget');
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    let isChatOpen = true;

    chatHeader.addEventListener('click', () => {
        isChatOpen = !isChatOpen;
        const bodyEl = chatWidget.querySelector('#chat-body');
        const inputEl = chatWidget.querySelector('#chat-input-container');

        if (isChatOpen) {
            bodyEl.style.display = 'flex';
            inputEl.style.display = 'flex';
        } else {
            bodyEl.style.display = 'none';
            inputEl.style.display = 'none';
        }
    });

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
