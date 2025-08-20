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
    // Scrape the page
    const url = `https://iask.ai/q?mode=question&options[detail_level]=concise&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // Use jsdom to parse and extract only the first paragraph
    const dom = new JSDOM(html);
    const p = dom.window.document.querySelector('div#output p');
    if (!p) {
      return res.status(404).json({ error: 'No paragraph found' });
    }

    // Remove all links (a tags) and any nested tags
    Array.from(p.querySelectorAll('a, sup, sub')).forEach(el => el.remove());

    // Get clean text and remove any bracketed footnotes, e.g., [1][2]
    let text = p.textContent || '';
    text = text.replace(/\[\d+(?:\]\[\d+)*\]/g, '');  // Removes [1], [1][2]
    text = text.replace(/\[.*?\]/g, '');              // Removes anything else in []
    text = text.replace(/\s+/g, ' ').trim();          // Normalize spaces, trim ends

    return res.status(200).json({
      text,
      query,
      url,
      length: text.length
    });
  } catch (error) {
    return res.status(500).json({ error: 'Extraction failed', details: error.message });
  }
};
