import { useLocation, useNavigate } from 'react-router-dom'
import { useAppKit, useAppKitAccount } from '@reown/appkit/react'
import { useEffect, useState } from 'react'
import { ethers } from 'ethers'

export default function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { open } = useAppKit()
  const { address, isConnected } = useAppKitAccount()
  const [ethBal, setEthBal] = useState('0.000')

  useEffect(() => {
    if (!isConnected || !address) { setEthBal('0.000'); return }
    const provider = new ethers.providers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/kAmtb3hCAJaBhgQWSJBVs')
    provider.getBalance(address).then(b => setEthBal(Number(ethers.utils.formatUnits(b, 18)).toFixed(3))).catch(() => setEthBal('0.000'))
  }, [address, isConnected])

  const tab = location.pathname === '/stake' ? 'stake' : 'swap'

  return (
    <nav>
      <div className="logo">$<span>GM</span></div>
      <div className="nav-mid">
        <a className={'nav-tab' + (tab === 'swap' ? ' active' : '')} onClick={() => navigate('/swap')}>SWAP</a>
        <a className={'nav-tab' + (tab === 'stake' ? ' active' : '')} onClick={() => navigate('/stake')}>STAKE</a>
      </div>
      <div className="nav-right">
        <div className="bal">
          <span className={'dot' + (isConnected ? '' : ' off')}></span>
          <span>{isConnected ? 'connected' : 'not connected'}</span>
        </div>
        {isConnected && <div className="bal">Ξ {ethBal}</div>}
        {isConnected ? (
          <button className="wallet-btn" onClick={() => open({ view: 'Account' })}>
            {address.slice(0, 6)}..{address.slice(-4)}
          </button>
        ) : (
          <button className="wallet-btn" onClick={() => open()}>CONNECT WALLET</button>
        )}
      </div>
    </nav>
  )
}
