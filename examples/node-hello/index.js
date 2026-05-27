const express = require('express')
const app = express()
const port = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Hello from Launchly!',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
