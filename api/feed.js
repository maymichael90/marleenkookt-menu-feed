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

function getTag(str, tag) {
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

function titleFromUrl(url) {
  if (!url) return '';
  try {
    const slug = url.split('/').pop().split('?')[0].replace('.html', '');
    return slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  } catch (e) { return ''; }
}

function parseProducts(xml, fromDate) {
  const products = [];
  const blocks = xml.split(/<product\s+/i).slice(1);

  for (let block of blocks) {
    const chunk = '<product ' + block;
    const date = getTag(chunk, 'date');
    if (!date || date < fromDate) continue;

    if (getTag(chunk, 'is_main_course') !== '1' || getTag(chunk, 'is_visible_in_menu') !== '1') continue;

    const type = getTag(chunk, 'type');
    if (SKIP_TYPES.includes(type)) continue;

    let name = getTag(chunk, 'n') || getTag(chunk, 'name') || titleFromUrl(getTag(chunk, 'url')) || "Lekker gerecht";
    const skuMatch = chunk.match(/sku="([^"]+)"/i);

    products.push({
      date,
      sku: skuMatch ? skuMatch[1] : 'MKM-' + Math.random().toString(36).substr(2, 5),
      name,
      url: getTag(chunk, 'url'),
      image_url: getTag(chunk, 'image_url'),
      price: getTag(chunk, 'price'),
      description: getTag(chunk, 'description'),
      type,
    });
  }
  return products;
}

function pickFour(products) {
  const byDate = {};
  for (const p of products) {
    if (!byDate[p.date]) byDate[p.date
