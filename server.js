require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const multer = require('multer');
const pdf = require('pdf-parse');
const https = require('https');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set in the .env file');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const MODEL = 'gpt-5.2';

const generateOutreach = async (profileText) => {
    const prompt = `
        As a world-class recruiter at Deriv specializing in "character-first" hiring, draft a hyper-personalized, compelling outreach message based on the following candidate profile. The tone should be authentic, avoiding corporate jargon, and focus on the candidate's unique skills, potential, and cultural fit. Reference a specific detail from their profile to show you've done your research.

        Candidate Profile:
        ---
        ${profileText}
        ---

        Generate a message that is insightful, concise, and genuinely intriguing to a top-tier candidate.
    `;
    
    const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: 'You are a world-class recruiter specializing in personalized outreach messages.' },
            { role: 'user', content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.7,
    });
    
    return response.choices[0].message.content;
};

app.post('/api/generate-outreach-text', async (req, res) => {
    try {
        const { candidateProfile } = req.body;
        if (!candidateProfile) return res.status(400).json({ error: 'Candidate profile text is required.' });
        const message = await generateOutreach(candidateProfile);
        res.json({ outreachMessage: message });
    } catch (error) {
        console.error('Error in text outreach:', error);
        res.status(500).json({ error: 'Failed to generate outreach message from text. ' + (error.message || '') });
    }
});

app.post('/api/generate-outreach-file', upload.single('resume'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No resume file uploaded.' });
        const data = await pdf(req.file.buffer);
        const message = await generateOutreach(data.text);
        res.json({ outreachMessage: message });
    } catch (error) {
        console.error('Error in file outreach:', error);
        res.status(500).json({ error: 'Failed to process resume file. ' + (error.message || '') });
    }
});

app.post('/api/generate-outreach-url', (req, res) => {
    const { profileUrl } = req.body;
    if (!profileUrl) {
        return res.status(400).json({ error: 'Profile URL is required.' });
    }

    // Validate URL format
    let parsedUrl;
    try {
        parsedUrl = new URL(profileUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return res.status(400).json({ error: 'Invalid URL protocol. Use http or https.' });
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid URL format.' });
    }

    const httpModule = parsedUrl.protocol === 'https:' ? https : require('http');
    
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
    };

    httpModule.get(profileUrl, options, (httpRes) => {
        // Handle redirects
        if (httpRes.statusCode >= 300 && httpRes.statusCode < 400 && httpRes.headers.location) {
            return res.status(400).json({ error: 'URL redirects are not supported. Please use the final URL.' });
        }
        
        if (httpRes.statusCode !== 200) {
            return res.status(400).json({ error: `Failed to fetch URL. Status: ${httpRes.statusCode}` });
        }

        let html = '';
        httpRes.on('data', (chunk) => { html += chunk; });
        httpRes.on('end', async () => {
            try {
                // Basic text extraction from HTML
                const textContent = html.replace(/<style[^>]*>.*?<\/style>/gs, '')
                                        .replace(/<script[^>]*>.*?<\/script>/gs, '')
                                        .replace(/<[^>]+>/g, ' ')
                                        .replace(/&nbsp;/g, ' ')
                                        .replace(/&amp;/g, '&')
                                        .replace(/&lt;/g, '<')
                                        .replace(/&gt;/g, '>')
                                        .replace(/\s\s+/g, ' ')
                                        .trim();

                if (textContent.length < 100) {
                    return res.status(400).json({ error: 'Could not extract meaningful content from URL. The page may require authentication or block scraping.' });
                }
                const message = await generateOutreach(textContent.substring(0, 10000)); // Limit content length
                res.json({ outreachMessage: message });
            } catch (error) {
                console.error('Error processing scraped content:', error);
                res.status(500).json({ error: 'Failed to generate message from URL content. ' + (error.message || '') });
            }
        });
    }).on('error', (error) => {
        console.error(`Error scraping URL ${profileUrl}:`, error);
        res.status(500).json({ error: 'Failed to scrape profile URL. ' + (error.message || '') });
    });
});

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running and healthy.' });
});

app.post('/api/market-chat', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'Query is required.' });
        
        const systemPrompt = `You are a specialized Market Intelligence Assistant for the Malaysian tech talent landscape. Your knowledge base includes real-time salary trends, competitor hiring activities, and talent pool analysis. Your primary user is a recruiter from Deriv. Answer queries with concise, actionable, and data-driven insights. If you don't have the exact data, provide a well-reasoned estimate or suggest where to find it.`;
        
        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: query }
            ],
            max_tokens: 1500,
            temperature: 0.7,
        });
        
        res.json({ chatResponse: response.choices[0].message.content });
    } catch (error) {
        console.error('Error calling OpenAI API for chat:', error);
        res.status(500).json({ error: 'Failed to get market intelligence. ' + (error.message || '') });
    }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
