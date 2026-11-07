import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next';
import i18n, { browserLanguage, loadLanguage } from './i18n.js';
import './index.css'
import App from './App.jsx'

// The first page draws once the texts of its language are in (or failed to
// come, so a lost connection still draws a page rather than nothing).
loadLanguage(browserLanguage()).catch(() => {}).then(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>,
))
