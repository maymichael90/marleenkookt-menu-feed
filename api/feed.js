const https = require('https');

const FEED_URL   = 'https://www.marleenkookt.nl/menu/feed/xml';
const MEAT_TYPES = ['meat', 'fish', 'exclusive'];
const VEG_TYPES  = ['vegetarian', 'bowl'];
const SKIP_TYPES = ['kids', 'soup', 'dessert', 'breakfast'];
const TYPE_NL    = { meat:'Vleesgerecht', fish:'Visgerecht', exclusive:'Exclusief', vegetarian:'Vegetarisch', bowl:'Salade' };

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toYMD(date) {
  return date.toISOString().slice(0, 10);
}

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Verbeterde tag extractor die beter omgaat met korte tagnamen zoals <n>
function getTag(str, tag) {
  // Specifieke check voor de 'n' tag (titel) omdat die vaak de boosdoener is
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>');
  const m = str.match(re);
  if (!m) return '';
  
  return m[1]
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x20AC;/g, '€')
    .replace(/&#xA0;/g, ' ')
    .trim();
}

function parseProducts(xml, fromDate) {
  const products = [];
  // De feed gebruikt <product sku="...">...</product>
  const productRe = /<product\s+sku="([^"]+)">([\s\S]*?)<\/product>/g;
  let match;

  while ((match = productRe.exec(xml)) !== null) {
    const sku   = match[1];
    const chunk = match[2];

    const date = getTag(chunk, 'date');
    if (!date || date < fromDate) continue;

    const isMain    = getTag(chunk, 'is_main_course');
    const isVisible = getTag(chunk, 'is_visible_in_menu');
    
    // MarleenKookt feed gebruikt soms "1" als string
    if (isMain !== '1' || isVisible !== '1') continue;

    const type = getTag(chunk, 'type');
    if (SKIP_TYPES.includes(type)) continue;

    // Belangrijk: De titel zit in de <n> tag
    const name = getTag(chunk, 'n');

    products.push({
      date,
      sku,
      name,
      url:         getTag(chunk, 'url'),
      image_url:   getTag(chunk, 'image_url'),
      price:       getTag(chunk, 'price'),
      description: getTag(chunk, 'description'),
      type,
    });
  }

  return products;
}

function pickFour(products) {
  const byDate = {};
  for (const p of products) {
    if (!byDate[p.date]) byDate[p.date] = [];
    byDate[p.date].push(p);
  }
  const dates = Object.keys(byDate).sort();
  const picked = [];
  const usedSkus = new Set();

  for (const date of dates) {
    if (picked.length >= 4) break;
    const day = byDate[date];
    // Zoek eerst vlees en dan vega per dag om variatie te krijgen
    const meat = day.find(p => MEAT_TYPES.includes(p.type) && !usedSkus.has(p.sku));
    if (meat && picked.length < 4) { picked.push(meat); usedSkus.add(meat.sku); }
    
    const veg  = day.find(p => VEG_TYPES.includes(p.type)  && !usedSkus.has(p.sku));
    if (veg  && picked.length < 4) { picked.push(veg);  usedSkus.add(veg.sku);  }
  }

  // Backup als we nog geen 4 gerechten hebben
  if (picked.length < 4) {
    for (const p of products) {
      if (picked.length >= 4) break;
      if (!usedSkus.has(p.sku)) { picked.push(p); usedSkus.add(p.sku); }
    }
  }
  return picked.slice(0, 4);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const monday   = getNextMonday();
    const fromDate = toYMD(monday);

    const xml      = await fetchXML(FEED_URL);
    const products = parseProducts(xml, fromDate);
    const four     = pickFour(products);

    if (four.length === 0) {
      return res.status(200).json({ items: [] });
    }

    const items = four.map((p, i) => ({
      id:          p.sku || 'item-' + i,
      title:       p.name, // Hier komt nu de waarde uit <n> terecht
      description: p.description,
      url:         p.url,
      image_url:   p.image_url,
      price:       parseFloat(p.price) || 0,
      custom_metadata: {
        type:    p.type,
        type_nl: TYPE_NL[p.type] || p.type,
        date:    p.date,
      }
    }));

    res.status(200).json({ items });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching menu feed' });
  }
};
