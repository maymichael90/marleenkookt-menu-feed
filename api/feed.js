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
    const request = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    request.on('error', (err) => reject(err));
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error("Timeout bij ophalen feed"));
    });
  });
}

function getTag(str, tag) {
  if (!str) return '';
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const m = str.match(re);
  if (!m || !m[1]) return '';

  return m[1]
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x20AC;/g, '€')
    .replace(/&#xA0;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseProducts(xml, fromDate) {
  const products = [];
  if (!xml) return products;

  const blocks = xml.split(/<product\s+/i).slice(1);

  for (let block of blocks) {
    try {
      const chunk = '<product ' + block;
      const date = getTag(chunk, 'date');
      
      if (!date || date < fromDate) continue;
      if (getTag(chunk, 'is_main_course') !== '1' || getTag(chunk, 'is_visible_in_menu') !== '1') continue;

      const type = getTag(chunk, 'type');
      if (SKIP_TYPES.includes(type)) continue;

      // Robuuste titel check
      let name = getTag(chunk, 'n') || getTag(chunk, 'name');
      
      // Als naam nog steeds leeg is, gebruik de URL slug als noodoplossing
      if (!name) {
        const url = getTag(chunk, 'url');
        name = url ? url.split('/').pop().replace('.html', '').split('-').join(' ') : "Lekker gerecht";
      }

      const skuMatch = chunk.match(/sku="([^"]+)"/i);
      const sku = skuMatch ? skuMatch[1] : 'MKM-' + Math.random().toString(36).substr(2, 5);

      products.push({
        date,
        sku,
        name,
        url: getTag(chunk, 'url'),
        image_url: getTag(chunk, 'image_url'),
        price: getTag(chunk, 'price'),
        description: getTag(chunk, 'description'),
        type,
      });
    } catch (e) {
      console.error("Fout bij parsen product-blok:", e);
      continue; // Sla dit product over bij een fout
    }
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
    const meat = day.find(p => MEAT_TYPES.includes(p.type) && !usedSkus.has(p.sku));
    if (meat && picked.length < 4) { picked.push(meat); usedSkus.add(meat.sku); }
    const veg = day.find(p => VEG_TYPES.includes(p.type) && !usedSkus.has(p.sku));
    if (veg && picked.length < 4) { picked.push(veg); usedSkus.add(veg.sku); }
  }
  return picked.slice(0, 4);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const monday = getNextMonday();
    const fromDate = toYMD(monday);

    const xml = await fetchXML(FEED_URL);
    const products = parseProducts(xml, fromDate);
    const four = pickFour(products);

    // Klaviyo-vriendelijke output
    const items = four.map(p => ({
      id:          p.sku,
      title:       p.name,
      description: p.description,
      link:        p.url,
      image_link:  p.image_url,
