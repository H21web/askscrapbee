const fetch = require('node-fetch');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Query parameter missing' });
  }

  try {
    console.log(`🔍 Processing: ${query}`);
    
    // Try the direct page approach first
    const pageUrl = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
    
    // Simple approach: Multiple quick requests with increasing delays
    const delays = [0, 3000, 6000, 10000]; // 0s, 3s, 6s, 10s
    
    for (let i = 0; i < delays.length; i++) {
      console.log(`⏱️ Attempt ${i + 1}: ${delays[i]}ms delay`);
      
      if (delays[i] > 0) {
        await new Promise(resolve => setTimeout(resolve, delays[i]));
      }
      
      try {
        const response = await fetch(pageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://iask.ai/',
            'Cache-Control': 'no-cache'
          }
        });

        if (response.ok) {
          const html = await response.text();
          console.log(`📄 HTML received: ${html.length} chars`);
          
          // Simple extraction
          const content = simpleExtract(html);
          
          if (content && content.length >= 30) {
            console.log(`✅ SUCCESS: ${content.length} chars found!`);
            
            return res.status(200).json({
              success: true,
              text: content,
              query: query,
              url: pageUrl,
              attempt: i + 1,
              delay: delays[i],
              source: 'iask-ai',
              timestamp: new Date().toISOString(),
              textLength: content.length
            });
          }
        }
      } catch (e) {
        console.log(`❌ Request ${i + 1} failed: ${e.message}`);
      }
    }
    
    // If direct page fails, try to find if there's an API endpoint
    try {
      console.log('🔄 Trying alternative approaches...');
      
      // Method 1: Check for API endpoints
      const apiAttempts = [
        `https://iask.ai/api/search?q=${encodeURIComponent(query)}&format=json`,
        `https://iask.ai/search?q=${encodeURIComponent(query)}&format=json`,
        `https://api.iask.ai/search?query=${encodeURIComponent(query)}`
      ];
      
      for (const apiUrl of apiAttempts) {
        try {
          const apiResponse = await fetch(apiUrl, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0',
              'Referer': 'https://iask.ai/'
            }
          });
          
          if (apiResponse.ok) {
            const data = await apiResponse.json();
            if (data && (data.answer || data.response || data.text)) {
              const text = data.answer || data.response || data.text;
              if (text.length >= 30) {
                return res.status(200).json({
                  success: true,
                  text: cleanText(text),
                  query: query,
                  source: 'iask-api',
                  timestamp: new Date().toISOString()
                });
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
    } catch (e) {
      console.log('API attempts failed');
    }
    
    return res.status(404).json({
      error: 'iask.ai content not accessible',
      message: 'Unable to extract answer from iask.ai after multiple attempts. This could be due to the question being too specific, content still loading, or temporary access issues.',
      query: query,
      attempts: delays.length,
      totalTime: Math.max(...delays),
      suggestions: [
        'Try rephrasing with simpler, more general terms',
        'Wait a minute and try again',
        'Check if the question contains proper English keywords'
      ]
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Request failed',
      details: error.message,
      query: query
    });
  }
};

// SIMPLE extraction - no overcomplicated logic
function simpleExtract(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Debug: Check what's in the page
    console.log('🔍 Looking for content...');
    
    // Simple approach: Look for any div with id="output" 
    const outputDiv = doc.querySelector('#output');
    if (!outputDiv) {
      console.log('❌ No #output div found');
      return null;
    }
    
    console.log('✅ Found #output div');
    
    // Get all text from the output div
    let allText = outputDiv.textContent || outputDiv.innerText || '';
    console.log(`📝 Raw text length: ${allText.length}`);
    console.log(`📝 First 100 chars: "${allText.substring(0, 100)}"`);
    
    // Clean the text
    allText = cleanText(allText);
    
    // If we have substantial text, extract first meaningful paragraph
    if (allText.length > 50) {
      // Split into sentences and take the first substantial ones
      const sentences = allText.split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 20)
        .filter(s => !isJunkText(s));
      
      if (sentences.length > 0) {
        // Take first 1-2 sentences that make sense
        const result = sentences.slice(0, 2).join('. ').trim();
        if (result.length >= 30) {
          return result + (result.endsWith('.') ? '' : '.');
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Extraction error:', error.message);
    return null;
  }
}

// Clean text function
function cleanText(text) {
  if (!text) return '';
  
  // Remove obvious UI elements
  text = text.replace(/Email this answer|Share Answer|Add Email|Provided by iAsk\.ai|Ask AI|Thinking\.\.\.|Loading\.\.\.|Please wait/gi, '');
  
  // Remove CSS and technical stuff
  text = text.replace(/\.\w+\{[^}]*\}|@keyframes[^}]*\{[^}]*\}|animation[^;]*;|transform[^;]*;/g, '');
  
  // Remove footnotes and links
  text = text.replace(/\[\d+\]/g, '');
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Check if text is junk/UI text
function isJunkText(text) {
  const junkPatterns = [
    /email|share|add|spinner|animation|css|keyframe/i,
    /thinking|loading|please wait|provided by/i,
    /^.{1,10}$/  // Too short
  ];
  
  return junkPatterns.some(pattern => pattern.test(text));
}
