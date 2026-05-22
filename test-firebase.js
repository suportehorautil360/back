const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({
  ignoreUndefinedProperties: true,
  preferRest: true,
  databaseId: 'default',
});

db.collection('test')
  .add({ hello: 'world' })
  .then((ref) => console.log('SUCESSO! Doc ID:', ref.id))
  .catch((err) => console.error('ERRO:', err.message));
