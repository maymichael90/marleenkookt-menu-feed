const https = require('https');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;

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

async function deleteAllItems() {
  let cursor = null;
  let totalDeleted = 0;

  console.log('🗑️  Alle catalog items verwijderen...\n');

  do {
    // Get page of items
    const path = cursor
      ? `/api/catalog-items/?page[cursor]=${cursor}`
      : '/api/catalog-items/';

    const res = await klaviyoRequest('GET', path, null);
    const data = JSON.parse(res.body);

    if (!data.data || data.data.length === 0) {
      console.log('Geen items meer gevonden.');
      break;
    }

    console.log(`📋 ${data.data.length} items gevonden op deze pagina`);

    // Delete each item
    for (const item of data.data) {
      const del = await klaviyoRequest('DELETE', `/api/catalog-items/${item.id}/`, null);
      if (del.status === 204) {
        console.log(`🗑️  Verwijderd: ${item.attributes?.title || item.id}`);
        totalDeleted++;
      } else {
        console.warn(`⚠️  Kon niet verwijderen (${del.status}): ${item.id}`);
        console.warn(del.body);
      }
    }

    // Next page cursor
    cursor = data.links?.next
      ? new URL(data.links.next).searchParams.get('page[cursor]')
      : null;

  } while (cursor);

  console.log(`\n✅ Klaar — ${totalDeleted} items verwijderd`);
}

deleteAllItems().catch(err => {
  console.error('❌ Fout:', err.message);
  process.exit(1);
});
