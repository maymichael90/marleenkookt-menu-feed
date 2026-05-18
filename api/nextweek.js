const https = require('https');
const FEED_URL = 'https://www.marleenkookt.nl/menu/feed/xml';
const SKIP_TYPES = ['soup', 'dessert', 'breakfast'];
const DAY_NL = ['Zondag','Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag'];

function extract(str, tag) {
  const startTag = `<${tag}>`;
  const endTag   = `</${tag}>`;
  const start = str.indexOf(startTag);
  if (start === -1) return '';
  const end = str.indexOf(endTag, start);
  if (end === -1) return '';
  return str.substring(start + startTag.length, end)
    .replace(/<!\[CDATA\[/gi, '').replace(/\]\]>/gi, '')
    .replace(/&amp;/g, '&').replace(/&#x20AC;/g, '€').replace(/&#xA0;/g, ' ')
    .trim();
}

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  // If it's Saturday or Sunday, next Monday is this coming Monday
  // If it's Mon-Fri, next Monday is next week's Monday
  const diff = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getNextFriday(monday) {
  const d = new Date(monday + 'T00:00:00');
  d.setDate(d.getDate() + 4);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  try {
    const fromDate = getNextMonday();
    const toDate   = getNextFriday(fromDate);

    const xml = await new Promise((resolve, reject) => {
      https.get(FEED_URL, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });

    const products = [];
    const usedSkus = new Set();
    const rawItems = xml.split('<product ');

    for (let i = 1; i < rawItems.length; i++) {
      const item = rawItems[i];
      const itemDate = extract(item, 'date');
      if (!itemDate || itemDate < fromDate || itemDate > toDate) continue;
      if (extract(item, 'is_main_course') !== '1') continue;
      if (extract(item, 'is_visible_in_menu') !== '1') continue;

      const type = extract(item, 'type');
      if (SKIP_TYPES.includes(type)) continue;

      const skuMatch = item.match(/sku="([^"]+)"/);
      const sku = skuMatch ? skuMatch[1] : 'MKM-' + i;
      if (usedSkus.has(sku)) continue;
      usedSkus.add(sku);

      const dow = new Date(itemDate + 'T00:00:00').getDay();
      const isKids = type === 'kids';

      products.push({
        id:          sku,
        title:       extract(item, 'n') || extract(item, 'name'),
        description: extract(item, 'description').substring(0, 200),
        link:        'https://abonnementen.marleenkookt.nl/subscribe',
        image_link:  extract(item, 'image_url'),
        price:       parseFloat(extract(item, 'price')) || 13.50,
        google_product_category: isKids ? 'kids' : 'menu',
        condition:   DAY_NL[dow],
        date:        itemDate,
      });
    }

    res.status(200).json(products);

  } catch (err) {
    res.status(500).json({ error: 'Fetch failed', message: err.message });
  }
};
