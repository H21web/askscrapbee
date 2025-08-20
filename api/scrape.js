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
    console.log(`Processing query: ${query}`);
    const pageUrl = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;

    // Method: Multiple requests with increasing delays to handle lazy loading
    const delays = [3000, 5000, 8000]; // 3s, 5s, 8s delays
    
    for (let i = 0; i < delays.length; i++) {
      console.log(`Attempt ${i + 1}: Waiting ${delays[i]}ms for content to load...`);
      
      // Wait for the specified delay
      await new Promise(resolve => setTimeout(resolve, delays[i]));
      
      // Fetch the page
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        console.log(`HTTP ${response.status} on attempt ${i + 1}`);
        continue;
      }

      const html = await response.text();
      console.log(`HTML length: ${html.length}`);

      // Parse and extract content
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      
      // Try multiple selectors to find the answer
      const selectors = [
        'div#output p:first-of-type',
        'div#output p',
        '#output .answer p',
        '#output div p',
        '[data-testid="answer"] p'
      ];

      let extractedText = null;
      
      for (const selector of selectors) {
        const elements = doc.querySelectorAll(selector);
        
        for (const element of elements) {
          if (element && element.textContent) {
            let text = element.textContent.trim();
            
            // Skip if it's just loading text or empty
            if (text.length < 20 || 
                text.includes('Answer Provided by Ask ai') || 
                text.includes('Loading...') ||
                text.includes('Please wait')) {
              continue;
            }

            // Found valid content - clean it up
            console.log(`Found content with selector: ${selector}`);
            
            // Remove links, footnotes, etc.
            const clonedElement = element.cloneNode(true);
            Array.from(clonedElement.querySelectorAll('a, sup, sub')).forEach(el => el.remove());
            
            text = clonedElement.textContent || '';
            text = text.replace(/\[\d+(?:\]\[\d+)*\]/g, ''); // Remove [1], [1][2], etc.
            text = text.replace(/\[.*?\]/g, '');              // Remove any other brackets
            text = text.replace(/https?:\/\/[^\s]+/g, '');    // Remove URLs
            text = text.replace(/\s+/g, ' ').trim();          // Normalize whitespace
            
            if (text.length > 20) {
              extractedText = text;
              break;
            }
          }
        }
        
        if (extractedText) break;
      }

      // If we found content, return it
      if (extractedText) {
        console.log(`Successfully extracted content: ${extractedText.substring(0, 100)}...`);
        return res.status(200).json({
          success: true,
          text: extractedText,
          query: query,
          url: pageUrl,
          source: 'iask-ai-delayed',
          attempt: i + 1,
          delay: delays[i],
          timestamp: new Date().toISOString(),
          textLength: extractedText.length
        });
      }

      console.log(`No content found on attempt ${i + 1}`);
    }

    // If all attempts failed
    return res.status(404).json({
      error: 'Content not loaded',
      message: 'Unable to load answer content from iask.ai after multiple attempts. The page may be taking longer than expected to load.',
      query: query,
      url: pageUrl,
      attempts: delays.length,
      maxDelay: Math.max(...delays),
      suggestion: 'Try again later or rephrase your question'
    });

  } catch (error) {
    console.error('Scraping error:', error.message);
    return res.status(500).json({
      error: 'Scraping failed',
      details: error.message,
      query: query,
      timestamp: new Date().toISOString()
    });
  }
};
