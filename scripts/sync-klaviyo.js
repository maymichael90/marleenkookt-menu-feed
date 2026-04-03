const https = require('https');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const FEED_API_URL    = 'https://marleenkookt-menu-feed.vercel.app/api/feed';

// Correct Klaviyo compound ID format: $custom:::$default:::external_id
function itemId(externalId)     { return `$custom:::$default:::${externalId}`; }
function categoryId(externalId) { return `$custom:::$default:::${externalId}`; }

function klaviyoRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'a.klaviyo.com',
      path,
      method,
      headers: {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        'revision':      '2024-02-15',
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const categoryCache = {};

async function ensureCategory(name) {
  if (categoryCache[name]) return categoryCache[name];
  const extId = `mk-cat-${name}`;
  const id    = categoryId(extId);

  const res = await klaviyoRequest('POST', '/api/catalog-categories/', {
    data: {
      type: 'catalog-category',
      attributes: {
        external_id:  extId,
        catalog_type: '$default',
        name,
      }
    }
  });

  if (res.status === 201) {
    const parsed = JSON.parse(res.body);
    const realId = parsed.data.id;
    console.log(`📁 Category aangemaakt: ${name} → ${realId}`);
    categoryCache[name] = realId;
    return realId;
  } else if (res.status === 409) {
    const get = await klaviyoRequest('GET', `/api/catalog-categories/${encodeURIComponent(id)}/`, null);
    if (get.status === 200) {
      const realId = JSON.parse(get.body).data.id;
      console.log(`📁 Category bestaat: ${name} → ${realId}`);
      categoryCache[name] = realId;
      return realId;
    }
  }
  console.warn(`⚠️  Category fout (${res.status}): ${name}`);
  return null;
}

async function upsertItem(meal) {
  const id = itemId(meal.id);
  const attributes = {
    title:          meal.title,
    description:    meal.description,
    url:            meal.link,
    image_full_url: meal.image_link,
    price:          meal.price,
    published:      true,
    custom_metadata: {
      day:  meal.condition || '',
      date: meal.date || '',
      category: meal.google_product_category || '',
    }
  };

  // Try PATCH first
  const patch = await klaviyoRequest(
    'PATCH',
    `/api/catalog-items/${encodeURIComponent(id)}/`,
    { data: { type: 'catalog-item', id, attributes } }
  );

  if (patch.status === 200) {
    console.log(`🔄 Bijgewerkt: ${meal.title}`);
    return id;
  } else if (patch.status === 404) {
    // Create new
    const post = await klaviyoRequest('POST', '/api/catalog-items/', {
      data: {
        type: 'catalog-item',
        attributes: {
          external_id:  meal.id,
          catalog_type: '$default',
          ...attributes
        }
      }
    });
    if (post.status === 201) {
      const realId = JSON.parse(post.body).data.id;
      console.log(`✅ Aangemaakt: ${meal.title} → ${realId}`);
      return realId;
    } else {
      console.warn(`⚠️  Aanmaken fout (${post.status}): ${meal.title}`);
      console.warn(post.body);
      return null;
    }
  } else {
    console.warn(`⚠️  Update fout (${patch.status}): ${meal.title}`);
    console.warn(patch.body);
    return null;
  }
}

async function linkToCategory(itemKlaviyoId, catKlaviyoId) {
  if (!itemKlaviyoId || !catKlaviyoId) return;
  const res = await klaviyoRequest(
    'POST',
    `/api/catalog-categories/${encodeURIComponent(catKlaviyoId)}/relationships/items/`,
    { data: [{ type: 'catalog-item', id: itemKlaviyoId }] }
  );
  if (res.status === 204 || res.status === 200) {
    console.log(`🔗 Gekoppeld aan category`);
  } else if (res.status === 409) {
    console.log(`🔗 Al gekoppeld`);
  } else {
    console.warn(`⚠️  Koppelen fout (${res.status}): ${res.body}`);
  }
}

async function syncToKlaviyo() {
  try {
    console.log('📡 Feed ophalen...');
    const meals = await httpGet(FEED_API_URL);
    console.log(`📋 ${meals.length} maaltijden gevonden\n`);

    for (const meal of meals) {
      const catName = meal.google_product_category || 'overig';

      const catId  = await ensureCategory(catName);
      const itemKlaviyoId = await upsertItem(meal);
      await linkToCategory(itemKlaviyoId, catId);
      console.log('---');
    }

    console.log(`\n✅ Klaar — ${meals.length} maaltijden gesynchroniseerd`);
  } catch (err) {
    console.error('❌ Sync mislukt:', err.message);
    process.exit(1);
  }
}

syncToKlaviyo();
