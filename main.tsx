import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AuthRecoveryGate from './AuthRecoveryGate'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthRecoveryGate>
      <App />
    </AuthRecoveryGate>
  </StrictMode>,
)
