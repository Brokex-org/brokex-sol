import { createRoot } from 'react-dom/client'
import './index.css' // 🚨 C'est cette ligne qui charge ton reset plein écran !
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <App />
)