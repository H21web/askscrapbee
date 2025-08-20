const fetch = require('node-fetch');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

module.exports = async (req, res) => {
  // CORS headers
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
    console.log(`🔍 Processing query: ${query}`);
    
    const url = `https://www.bing.com/copilotsearch?q=${encodeURIComponent(query)}&FORM=CSSCOP`;
    console.log(`🌐 URL: ${url}`);
    
    // Try multiple times with delays to handle loading
    const maxAttempts = 5;
    const interval = 3000; // 3 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`📡 Attempt ${attempt}/${maxAttempts}: Fetching Bing Copilot...`);
      
      if (attempt > 1) {
        await sleep(interval);
      }
      
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
          }
        });

        if (!response.ok) {
          console.log(`❌ HTTP ${response.status} on attempt ${attempt}`);
          continue;
        }

        const html = await response.text();
        console.log(`📄 HTML received: ${html.length} characters`);
        
        const answerText = extractStrongTagsFromAnswerContainer(html);
        
        if (answerText && answerText.length >= 20) {
          console.log(`✅ SUCCESS: Found answer with ${answerText.length} characters`);
          
          return res.status(200).json({
            success: true,
            text: answerText,
            query: query,
            url: url,
            attempt: attempt,
            source: 'bing-copilot',
            timestamp: new Date().toISOString(),
            textLength: answerText.length
          });
        } else if (answerText) {
          console.log(`📏 Found text but too short: ${answerText.length} chars`);
        } else {
          console.log(`❌ No answer found on attempt ${attempt}`);
        }
        
      } catch (fetchError) {
        console.log(`🌐 Network error on attempt ${attempt}: ${fetchError.message}`);
        continue;
      }
    }

    return res.status(404).json({
      error: 'No answer found',
      message: 'Could not extract answer from Bing Copilot search after multiple attempts',
      query: query,
      url: url,
      attempts: maxAttempts
    });

  } catch (error) {
    console.error('🔥 Service error:', error.message);
    return res.status(500).json({
      error: 'Service error',
      details: error.message,
      query: query
    });
  }
};

// Extract text from <strong> tags inside <div class="answer_container">
function extractStrongTagsFromAnswerContainer(html) {
  try {
    console.log('🔍 Parsing HTML for answer container...');
    
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Find the answer container div
    const answerContainer = document.querySelector('div.answer_container');
    if (!answerContainer) {
      console.log('❌ No div.answer_container found');
      return null;
    }
    
    console.log('✅ Found div.answer_container');
    
    // Find all <strong> tags inside the container
    const strongTags = answerContainer.querySelectorAll('strong');
    if (!strongTags || strongTags.length === 0) {
      console.log('❌ No <strong> tags found inside answer_container');
      return null;
    }
    
    console.log(`📝 Found ${strongTags.length} <strong> tags`);
    
    // Extract text from strong tags and filter
    const textParts = [];
    
    strongTags.forEach((strong, index) => {
      let text = strong.textContent || '';
      text = text.trim();
      
      console.log(`📄 Strong tag ${index + 1}: "${text.substring(0, 50)}..."`);
      
      // Skip if it's loading text or too short
      if (text.length < 5) return;
      if (isLoadingText(text)) {
        console.log(`⏳ Skipping loading text: "${text}"`);
        return;
      }
      
      textParts.push(text);
    });
    
    if (textParts.length === 0) {
      console.log('❌ No valid text found in strong tags');
      return null;
    }
    
    // Join all text parts
    const finalText = textParts.join(' ').trim();
    console.log(`✅ Extracted text: "${finalText.substring(0, 100)}..."`);
    
    return finalText;
    
  } catch (error) {
    console.error('❌ Extraction error:', error.message);
    return null;
  }
}

// Check if text indicates loading state
function isLoadingText(text) {
  const loadingPatterns = [
    /loading/i,
    /please wait/i,
    /thinking/i,
    /searching/i,
    /processing/i,
    /\.\.\./,
    /^[.\s]*$/
  ];
  
  return loadingPatterns.some(pattern => pattern.test(text));
}

// Sleep utility function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
