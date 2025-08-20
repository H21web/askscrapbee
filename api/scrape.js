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

    const maxAttempts = 15;
    const checkInterval = 3000;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Attempt ${attempt}/${maxAttempts}: Checking for content...`);
      
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) continue;

      const html = await response.text();
      const cleanText = extractCleanAnswerText(html);
      
      if (cleanText) {
        console.log(`✅ Clean answer found on attempt ${attempt}!`);
        return res.status(200).json({
          success: true,
          text: cleanText,
          query: query,
          url: pageUrl,
          attempt: attempt,
          timestamp: new Date().toISOString(),
          textLength: cleanText.length
        });
      } else {
        console.log(`⏳ No clean content yet on attempt ${attempt}...`);
      }
    }

    return res.status(408).json({
      error: 'Content load timeout',
      message: 'Could not extract clean answer text from iask.ai',
      query: query
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Scraping failed',
      details: error.message,
      query: query
    });
  }
};

// Enhanced clean text extraction
function extractCleanAnswerText(html) {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    // Remove all unwanted elements first
    const unwantedSelectors = [
      'style', 'script', 'noscript',           // Technical elements
      '.spinner', '[class*="spinner"]',         // Loading spinners
      'button', 'input', 'form',               // UI elements
      '.share', '.email', '[class*="share"]',   // Share buttons
      '.footer', '.header', '.nav',            // Navigation
      '[class*="animation"]', '[class*="keyframe"]' // CSS animations
    ];
    
    unwantedSelectors.forEach(selector => {
      const elements = doc.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });

    // Look for the main answer content
    const outputDiv = doc.querySelector('div#output');
    if (!outputDiv) return null;

    // Try to find the main answer paragraph(s)
    const answerSelectors = [
      'div#output > p:first-of-type',     // First paragraph in output
      'div#output p:not(:last-child)',    // All paragraphs except last (often contains UI text)
      'div#output .answer',               // Answer-specific class
      'div#output .content',              // Content-specific class
      'div#output div:first-child p'     // First div's paragraphs
    ];

    for (const selector of answerSelectors) {
      const elements = doc.querySelectorAll(selector);
      
      for (const element of elements) {
        if (!element) continue;
        
        // Clone element to avoid modifying original
        const clonedElement = element.cloneNode(true);
        
        // Remove links, footnotes, citations, buttons
        const unwantedTags = ['a', 'sup', 'sub', 'cite', 'button', 'span[class*="spinner"]'];
        unwantedTags.forEach(tag => {
          clonedElement.querySelectorAll(tag).forEach(el => el.remove());
        });
        
        let text = clonedElement.textContent || '';
        
        // Clean the text thoroughly
        text = cleanText(text);
        
        // Validate if this is actually answer content
        if (isValidAnswerText(text)) {
          return text;
        }
      }
    }

    // Fallback: Try to extract from the entire output div but be more selective
    let allText = outputDiv.textContent || '';
    allText = cleanText(allText);
    
    // Split into sentences and take the first substantial ones
    const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    if (sentences.length > 0) {
      // Take first 2-3 sentences that look like actual content
      const cleanSentences = sentences.slice(0, 3).filter(sentence => {
        const s = sentence.trim();
        return s.length > 20 && 
               !s.toLowerCase().includes('email') &&
               !s.toLowerCase().includes('share') &&
               !s.toLowerCase().includes('spinner') &&
               !s.toLowerCase().includes('animation') &&
               !s.toLowerCase().includes('provided by');
      });
      
      if (cleanSentences.length > 0) {
        return cleanSentences.join('. ').trim() + '.';
      }
    }

    return null;
    
  } catch (error) {
    console.error('Text extraction error:', error.message);
    return null;
  }
}

// Comprehensive text cleaning function
function cleanText(text) {
  if (!text) return '';
  
  // Remove CSS and animation code
  text = text.replace(/\.\w+\{[^}]*\}/g, '');                    // CSS classes
  text = text.replace(/@keyframes[^}]*\{[^}]*\}/g, '');          // CSS keyframes
  text = text.replace(/animation[^;]*;/g, '');                   // CSS animation properties
  text = text.replace(/transform[^;]*;/g, '');                   // CSS transform properties
  
  // Remove UI text patterns
  text = text.replace(/Email this answer/gi, '');
  text = text.replace(/Add Email/gi, '');
  text = text.replace(/Add at least one email/gi, '');
  text = text.replace(/Share Answer/gi, '');
  text = text.replace(/Provided by iAsk\.ai/gi, '');
  text = text.replace(/Ask AI\.?/gi, '');
  text = text.replace(/spinner_\w+/gi, '');
  
  // Remove footnotes and references
  text = text.replace(/\[\d+\]/g, '');                           // [1], [1], etc.
  text = text.replace(/\[.*?\]/g, '');                           // Any other brackets
  
  // Remove URLs
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  
  // Remove extra whitespace and normalize
  text = text.replace(/\s+/g, ' ');                              // Multiple spaces to single
  text = text.replace(/\n+/g, ' ');                              // Newlines to spaces
  text = text.trim();
  
  // Remove common prefixes
  text = text.replace(/^(Answer:|Response:|Result:)\s*/i, '');
  
  return text;
}

// Validate if text looks like a real answer
function isValidAnswerText(text) {
  if (!text || text.length < 30) return false;
  
  // Check for unwanted patterns
  const unwantedPatterns = [
    /email/i, /share/i, /spinner/i, /animation/i, /keyframes/i,
    /\.css/i, /transform/i, /cubic-bezier/i, /translateY/i,
    /answer provided by/i, /ask ai/i, /loading/i, /thinking/i
  ];
  
  const hasUnwantedContent = unwantedPatterns.some(pattern => pattern.test(text));
  if (hasUnwantedContent) return false;
  
  // Should look like actual content (has common words)
  const commonWords = ['the', 'is', 'are', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  const hasCommonWords = commonWords.some(word => text.toLowerCase().includes(word));
  
  return hasCommonWords && text.length >= 30;
}
