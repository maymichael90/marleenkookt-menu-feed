const https = require('https');
const FEED_URL = 'https://www.marleenkookt.nl/menu/feed/xml';

const TYPE_NL = {
  meat:       'vlees',
  fish:       'vis',
  exclusive:  'exclusief',
  vegetarian: 'vegetarisch',
  bowl:       'salade',
  kids:       'kids',
  soup:       'soep',
  dessert:    'nagerecht',
  breakfast:  'ontbijt'
};

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
  const diff = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');

  try {
    const fromDate = getNextMonday();
    const fridayDate = new Date(fromDate);
    fridayDate.setDate(fridayDate.getDate() + 4);
    const toDate = fridayDate.toISOString().slice(0, 10);

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
      const skuMatch = item.match(/sku="([^"]+)"/);
      const sku = skuMatch ? skuMatch[1] : 'MKM-' + i;
      if (usedSkus.has(sku)) continue;
      usedSkus.add(sku);

      const dow = new Date(itemDate + 'T00:00:00').getDay();
      const categoryNL = TYPE_NL[type] || type;
      const dayName = DAY_NL[dow];

      // Klaviyo requires $google_product_category for category filtering
      // Use title with category prefix so filtering works via title search
      products.push({
        id:                        sku,
        title:                     extract(item, 'n') || extract(item, 'name'),
        description:               extract(item, 'description').substring(0, 200),
        link:                      extract(item, 'url'),
        image_link:                extract(item, 'image_url'),
        price:                     parseFloat(extract(item, 'price')) || 13.50,
        $google_product_category:  categoryNL,  // vlees / vis / vegetarisch / salade
        google_product_category:   categoryNL,  // fallback
        availability:              'in stock',
        condition:                 dayName,      // day name in condition field for filtering
      });
    }

    res.status(200).json(products);

  } catch (err) {
    res.status(500).json({ error: 'Fetch failed', message: err.message });
  }
};
