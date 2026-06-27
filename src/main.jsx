import React from 'react'
import ReactDOM from 'react-dom/client'
import { createAppKit } from '@reown/appkit/react'
import { Ethers5Adapter } from '@reown/appkit-adapter-ethers5'
import { mainnet } from '@reown/appkit/networks'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './App.css'

const projectId = 'b0db8a0e9feaf59699896d7c7bfa4c5f'

const metadata = {
  name: '$GM Dapp',
  description: 'Swap & Stake GM tokens',
  url: 'https://swapui.vercel.app',
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}

createAppKit({
  adapters: [new Ethers5Adapter()],
  networks: [mainnet],
  metadata,
  projectId,
  themeMode: 'dark',
  themeVariables: {
    '--apkt-color-mix': '#08080a',
    '--apkt-color-mix-strength': 100,
    '--apkt-accent': '#a0a0c0',
    '--apkt-font-family': "'JetBrains Mono', monospace",
    '--apkt-border-radius-master': '0',
    '--apkt-font-size-master': '10'
  },
  features: {
    analytics: false,
    socials: false,
    email: false
  },
  tokens: {
    1: { address: '0x0000000000000000000000000000000000000000', image: '' }
  },
  enableWalletConnect: true,
  enableInjected: true,
  enableCoinbase: true
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
