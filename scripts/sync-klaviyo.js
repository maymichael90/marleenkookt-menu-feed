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

const categoryCache = {};

async function ensureCategory(name) {
  if (categoryCache[name]) return categoryCache[name];
  const externalId = `mk-cat-${name}`;

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
    console.log(`📁 Category aangemaakt: ${name} (${id})`);
  } else if (res.status === 409) {
    const getRes = await klaviyoRequest('GET', `/api/catalog-categories/${CATALOG_TYPE}::${externalId}/`, null);
    id = JSON.parse(getRes.body).data.id;
    console.log(`📁 Category bestaat al: ${name} (${id})`);
  } else {
    console.warn(`⚠️  Category fout (${res.status}): ${res.body}`);
    return null;
  }

  categoryCache[name] = id;
  return id;
}

async function upsertMeal(meal) {
  const categoryName = meal.google_product_category || meal.category || 'overig';
  const categoryId   = await ensureCategory(categoryName);

  const attributes = {
    title:          meal.title,
    description:    meal.description,
    url:            meal.link,
    image_full_url: meal.image_link,
    price:          meal.price,
    published:      true,
    custom_metadata: {
      day:  meal.condition,
      date: meal.date,
    }
  };

  const relationships = categoryId ? {
    categories: { data: [{ type: 'catalog-category', id: categoryId }] }
  } : undefined;

  const patch = await klaviyoRequest(
    'PATCH',
    `/api/catalog-items/${CATALOG_TYPE}::${meal.id}/`,
    { data: { type: 'catalog-item', id: `${CATALOG_TYPE}::${meal.id}`, attributes, relationships } }
  );

  if (patch.status === 404) {
    await klaviyoRequest('POST', '/api/catalog-items/', {
      data: {
        type: 'catalog-item',
        attributes: { external_id: meal.id, catalog_type: CATALOG_TYPE, ...attributes },
        relationships
      }
    });
    console.log(`✅ Aangemaakt: ${meal.title} [${categoryName}]`);
  } else {
    console.log(`🔄 Bijgewerkt:  ${meal.title} [${categoryName}]`);
  }
}

async function syncToKlaviyo() {
  try {
    console.log('📡 Feed ophalen...');
    const meals = await httpGet(FEED_API_URL);
    console.log(`📋 ${meals.length} maaltijden gevonden`);
    for (const meal of meals) {
      await upsertMeal(meal);
    }
    console.log(`\n✅ Klaar — ${meals.length} maaltijden gesynchroniseerd`);
  } catch (err) {
    console.error('❌ Sync mislukt:', err.message);
    process.exit(1);
  }
}

syncToKlaviyo();
