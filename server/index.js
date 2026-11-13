const { openDb } = require('./db');
const { createApp } = require('./app');

const port = process.env.PORT || 3000;
const app = createApp(openDb());
app.listen(port, () => console.log(`LiteDocs running on http://localhost:${port}`));
