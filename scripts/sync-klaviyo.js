const https = require('https');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const FEED_API_URL    = 'https://marleenkookt-menu-feed.vercel.app/api/feed';
const CATALOG_TYPE    = '$default';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

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

// ── STEP 1: Create or get category, return Klaviyo ID ──
const categoryCache = {};

async function ensureCategory(name) {
  if (categoryCache[name]) return categoryCache[name];

  const externalId = `mk-cat-${name}`;

  // Try to create
  const res = await klaviyoRequest('POST', '/api/catalog-categories/', {
    data: {
      type: 'catalog-category',
      attributes: {
        external_id:  externalId,
        catalog_type: CATALOG_TYPE,
        name,
      }
    }
  });

  let id;
  if (res.status === 201) {
    id = JSON.parse(res.body).data.id;
    console.log(`📁 Category aangemaakt: ${name} → ${id}`);
  } else if (res.status === 409) {
    // Already exists — fetch it
    const get = await klaviyoRequest('GET', `/api/catalog-categories/${CATALOG_TYPE}:::${externalId}/`, null);
    if (get.status === 200) {
      id = JSON.parse(get.body).data.id;
      console.log(`📁 Category bestaat: ${name} → ${id}`);
    } else {
      console.warn(`⚠️  Kan category niet ophalen: ${name} (${get.status})`);
      return null;
    }
  } else {
    console.warn(`⚠️  Category fout (${res.status}): ${res.body}`);
    return null;
  }

  categoryCache[name] = id;
  return id;
}

// ── STEP 2: Upsert item (without category relationship) ──
async function upsertItem(meal) {
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
    }
  };

  const patch = await klaviyoRequest(
    'PATCH',
    `/api/catalog-items/${CATALOG_TYPE}:::${meal.id}/`,
    { data: { type: 'catalog-item', id: `${CATALOG_TYPE}:::${meal.id}`, attributes } }
  );

  if (patch.status === 404) {
    const post = await klaviyoRequest('POST', '/api/catalog-items/', {
      data: {
        type: 'catalog-item',
        attributes: { external_id: meal.id, catalog_type: CATALOG_TYPE, ...attributes }
      }
    });
    if (post.status === 201) {
      console.log(`✅ Aangemaakt: ${meal.title}`);
    } else {
      console.warn(`⚠️  Aanmaken mislukt (${post.status}): ${meal.title}`);
      console.warn(post.body);
    }
  } else if (patch.status === 200) {
    console.log(`🔄 Bijgewerkt: ${meal.title}`);
  } else {
    console.warn(`⚠️  Update fout (${patch.status}): ${meal.title}`);
    console.warn(patch.body);
  }
}

// ── STEP 3: Link item to category via relationships endpoint ──
async function linkItemToCategory(itemId, categoryId) {
  const res = await klaviyoRequest(
    'POST',
    `/api/catalog-categories/${categoryId}/relationships/items/`,
    {
      data: [{ type: 'catalog-item', id: `${CATALOG_TYPE}:::${itemId}` }]
    }
  );
  if (res.status === 204 || res.status === 200) {
    console.log(`🔗 Gekoppeld: ${itemId} → ${categoryId}`);
  } else if (res.status === 409) {
    console.log(`🔗 Al gekoppeld: ${itemId}`);
  } else {
    console.warn(`⚠️  Koppelen mislukt (${res.status}): ${res.body}`);
  }
}

// ── MAIN ────────────────────────────────────────────────
async function syncToKlaviyo() {
  try {
    console.log('📡 Feed ophalen...');
    const meals = await httpGet(FEED_API_URL);
    console.log(`📋 ${meals.length} maaltijden gevonden\n`);

    for (const meal of meals) {
      const categoryName = meal.google_product_category || meal.category || 'overig';

      // 1. Ensure category exists
      const categoryId = await ensureCategory(categoryName);

      // 2. Upsert the item
      await upsertItem(meal);

      // 3. Link item to category (separate API call)
      if (categoryId) {
        await linkItemToCategory(meal.id, categoryId);
      }

      console.log('---');
    }

    console.log(`\n✅ Klaar — ${meals.length} maaltijden gesynchroniseerd`);
  } catch (err) {
    console.error('❌ Sync mislukt:', err.message);
    process.exit(1);
  }
}

syncToKlaviyo();
