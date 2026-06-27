import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import { CONFIG, ALCHEMY_RPC } from '../config'

const HOOK_ABI = [
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'function claim()',
  'function token() view returns (address)',
  'function totalStaked() view returns (uint256)',
  'function currentTaxBps() view returns (uint256)',
  'function pendingRewards(address) view returns (uint256)',
  'function pendingTokens(address) view returns (uint256)',
  'function penaltyBps(address) view returns (uint256)',
  'function stakes(address) view returns (uint256 amount, uint256 rewardDebt, uint256 tokenDebt, uint64 unlockAt)',
  'function PENALTY_WINDOW() view returns (uint256)'
]
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
]

const MAXU = ethers.constants.MaxUint256

export default function StakePage() {
  const { address, isConnected } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider('eip155')

  const [mode, setMode] = useState('stake')
  const [amount, setAmount] = useState('')
  const [toast, setToast] = useState({ msg: '', kind: '', show: false })
  const [busy, setBusy] = useState(false)
  const stRef = useRef({
    walEth: ethers.constants.Zero, tokenBal: ethers.constants.Zero, allowance: ethers.constants.Zero,
    totalStaked: ethers.constants.Zero, taxBps: 0, myStake: ethers.constants.Zero,
    pendingEth: ethers.constants.Zero, pendingTok: ethers.constants.Zero, penBps: 0, unlockAt: 0
  })
  const contractsRef = useRef({ provider: null, signer: null, hook: null, token: null, tokenDecimals: 18, tokenSym: 'GM', account: null })
  const [penBpsDisplay, setPenBpsDisplay] = useState(0)
  const [unlockAt, setUnlockAt] = useState(0)
  const refreshTimer = useRef(null)
  const penTimer = useRef(null)

  const short = a => a.slice(0, 6) + '..' + a.slice(-4)
  const sym = () => '$' + String(contractsRef.current.tokenSym).replace(/^\$/, '')

  const showToast = useCallback((msg, kind = '') => {
    setToast({ msg, kind, show: true })
    setTimeout(() => setToast(s => ({ ...s, show: false })), kind === 'ok' ? 4000 : 3500)
  }, [])

  const errMsg = useCallback(e => {
    const m = e?.data?.message || e?.error?.message || e?.reason || e?.message || 'transaction failed'
    if (/user rejected|denied/i.test(m)) return 'Rejected in wallet'
    return m.length > 80 ? m.slice(0, 80) + '…' : m
  }, [])

  const fmt = useCallback((bn, dec = 18, p = 3) => {
    try { return Number(ethers.utils.formatUnits(bn, dec)).toLocaleString(undefined, { maximumFractionDigits: p }) } catch { return '0' }
  }, [])

  const fmtEth = useCallback((bn, p = 4) => fmt(bn, 18, p), [fmt])
  const fmtTok = useCallback((bn, p = 2) => {
    try {
      const n = Number(ethers.utils.formatUnits(bn, contractsRef.current.tokenDecimals))
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
      return n.toLocaleString(undefined, { maximumFractionDigits: p })
    } catch { return '0' }
  }, [])

  const refresh = useCallback(async () => {
    const c = contractsRef.current
    if (!c.hook || !c.account) return
    try {
      const [walEth, tokenBal, allowance, totalStaked, taxBps, pendingEth, pendingTok, penBps, sInfo] = await Promise.all([
        c.provider.getBalance(c.account),
        c.token.balanceOf(c.account),
        c.token.allowance(c.account, CONFIG.HOOK),
        c.hook.totalStaked(),
        c.hook.currentTaxBps().catch(() => ethers.BigNumber.from(2000)),
        c.hook.pendingRewards(c.account),
        c.hook.pendingTokens(c.account),
        c.hook.penaltyBps(c.account),
        c.hook.stakes(c.account)
      ])
      stRef.current = {
        walEth, tokenBal, allowance, totalStaked, taxBps: taxBps.toNumber(),
        myStake: sInfo.amount, pendingEth, pendingTok,
        penBps: penBps.toNumber(), unlockAt: Number(sInfo.unlockAt)
      }
      setPenBpsDisplay(penBps.toNumber())
      setUnlockAt(Number(sInfo.unlockAt))
    } catch (e) { console.error(e) }
  }, [])

  const initContracts = useCallback(async () => {
    if (!walletProvider || !address) return
    try {
      const provider = new ethers.providers.Web3Provider(walletProvider, 'any')
      const signer = provider.getSigner()
      const net = await provider.getNetwork()
      if (CONFIG.CHAIN_ID && net.chainId !== CONFIG.CHAIN_ID) {
        try {
          await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CONFIG.CHAIN_ID.toString(16) }] })
        } catch { showToast('Wrong network — switch to chain ' + CONFIG.CHAIN_ID, 'err') }
      }
      const hook = new ethers.Contract(CONFIG.HOOK, HOOK_ABI, signer)
      const tokAddr = await hook.token()
      const token = new ethers.Contract(tokAddr, ERC20_ABI, signer)
      const tokenDecimals = await token.decimals().catch(() => 18)
      const tokenSym = await token.symbol().catch(() => 'GM')
      contractsRef.current = { provider, signer, hook, token, tokenDecimals, tokenSym, account: address }
      refresh()
    } catch (e) { showToast(errMsg(e), 'err') }
  }, [walletProvider, address, showToast, errMsg, refresh])

  useEffect(() => {
    if (isConnected && walletProvider) initContracts()
    else contractsRef.current = { provider: null, signer: null, hook: null, token: null, tokenDecimals: 18, tokenSym: 'GM', account: null }
  }, [isConnected, walletProvider, initContracts])

  useEffect(() => {
    clearInterval(refreshTimer.current)
    if (isConnected) {
      refreshTimer.current = setInterval(refresh, 12000)
    }
    return () => clearInterval(refreshTimer.current)
  }, [isConnected, refresh])

  useEffect(() => {
    clearInterval(penTimer.current)
    if (isConnected && unlockAt > 0) {
      penTimer.current = setInterval(() => {
        const left = unlockAt - Math.floor(Date.now() / 1000)
        if (left <= 0) return
        const bps = Math.round(10000 * left / (7 * 86400))
        setPenBpsDisplay(bps)
      }, 1000)
    }
    return () => clearInterval(penTimer.current)
  }, [isConnected, unlockAt])

  const amtBN = (() => {
    const raw = amount.trim()
    if (!raw || isNaN(raw) || Number(raw) <= 0) return null
    try { return ethers.utils.parseUnits(raw, contractsRef.current.tokenDecimals) } catch { return null }
  })()

  const balForMode = mode === 'stake' ? stRef.current.tokenBal : stRef.current.myStake
  const s = stRef.current

  let btnText = 'CONNECT WALLET', btnDisabled = true, btnClass = 'act-btn up'
  if (isConnected) {
    btnClass = 'act-btn ' + (mode === 'stake' ? 'up' : 'down')
    if (!amtBN) { btnText = 'ENTER AMOUNT'; btnDisabled = true }
    else if (mode === 'stake') {
      if (amtBN.gt(s.tokenBal)) { btnText = 'INSUFFICIENT BALANCE'; btnDisabled = true }
      else { btnDisabled = false; btnText = s.allowance.lt(amtBN) ? 'APPROVE $GM' : 'STAKE' }
    } else {
      if (amtBN.gt(s.myStake)) { btnText = 'EXCEEDS STAKE'; btnDisabled = true }
      else { btnDisabled = false; btnText = 'UNSTAKE' }
    }
  }

  const others = s.totalStaked.sub(s.myStake)
  const penAmt = amtBN ? amtBN.mul(s.penBps).div(10000) : ethers.constants.Zero
  const effPen = others.lte(0) ? ethers.constants.Zero : penAmt
  const out = amtBN ? amtBN.sub(effPen) : ethers.constants.Zero

  const doAction = async () => {
    if (busy || !isConnected) return
    if (!amtBN) return
    try {
      setBusy(true)
      const c = contractsRef.current
      if (mode === 'stake') {
        if (s.allowance.lt(amtBN)) {
          showToast('Approving $GM…')
          const tx = await c.token.approve(CONFIG.HOOK, MAXU); await tx.wait()
          stRef.current.allowance = MAXU
          showToast('Approved ✓', 'ok'); setBusy(false); return
        }
        showToast('Staking ' + fmtTok(amtBN) + ' ' + sym() + '…')
        const tx = await c.hook.stake(amtBN); await tx.wait()
        showToast('Staked ' + fmtTok(amtBN) + ' ' + sym() + ' ✓', 'ok')
      } else {
        showToast('Unstaking ' + fmtTok(amtBN) + ' ' + sym() + '…')
        const tx = await c.hook.unstake(amtBN); await tx.wait()
        showToast('Unstaked ✓ — rewards collected', 'ok')
      }
      setAmount(''); await refresh()
    } catch (e) { showToast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }

  const doClaim = async () => {
    if (busy || !isConnected) return
    try {
      setBusy(true)
      showToast('Claiming rewards…')
      const tx = await contractsRef.current.hook.claim(); await tx.wait()
      showToast('Claimed ✓', 'ok'); await refresh()
    } catch (e) { showToast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }

  const share = s.totalStaked.gt(0) ? (Number(s.myStake.mul(10000).div(s.totalStaked)) / 100).toFixed(2) : '0.00'
  const taperFrac = Math.min(1, Math.max(0, (2000 - s.taxBps) / (2000 - 500)))
  const penPct = (penBpsDisplay / 100).toFixed(1)

  return (
    <div className="wrap">
      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <div className="stat"><div className="stat-val">{isConnected ? fmtTok(s.totalStaked) : '—'}</div><div className="stat-lbl">TOTAL STAKED $GM</div></div>
        <div className="stat"><div className="stat-val eth">{isConnected ? fmtTok(s.myStake) : '—'}</div><div className="stat-lbl">YOUR STAKE</div></div>
        <div className="stat"><div className="stat-val eth">{isConnected ? fmtEth(s.pendingEth, 4) + '<span class="u">Ξ</span>' : '—'}</div><div className="stat-lbl">YOUR PENDING ETH</div></div>
        <div className="stat"><div className="stat-val">{isConnected ? (s.taxBps / 100).toFixed(2) + '<span class="u">%</span>' : '—'}</div><div className="stat-lbl">LIVE SWAP TAX</div></div>
      </div>

      <div className="taper">
        <div className="card-label"><span>SWAP TAX — TAPERS AS WE GROW</span><span className="card-label-right">50% OF EVERY TAX → STAKERS, PAID IN ETH</span></div>
        <div className="taper-top">
          <div className="taper-rate">{isConnected ? (s.taxBps / 100).toFixed(2) : '—'}<span className="u">current</span></div>
          <div className="taper-sub">
            starts at <b>20%</b> to bootstrap<br />
            tapers to <b>5%</b> as marketcap climbs<br />
            <span style={{ color: 'var(--acc2)' }}>
              {isConnected ? s.taxBps >= 2000 ? 'max tax · early bootstrap phase' : s.taxBps <= 500 ? 'min tax · matured' : 'tapering with marketcap' : 'connect to read live rate'}
            </span>
          </div>
        </div>
        <div className="taper-track"><div className="taper-fill"></div><div className="taper-marker" style={{ left: (taperFrac * 100).toFixed(1) + '%' }}></div></div>
        <div className="taper-ends"><span>20% · SMALL CAP</span><span>5% · MATURE</span></div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="seg">
            <div className={'seg-btn' + (mode === 'stake' ? ' active' : '')} onClick={() => { setMode('stake'); setAmount('') }}>STAKE</div>
            <div className={'seg-btn' + (mode === 'unstake' ? ' active' : '')} onClick={() => { setMode('unstake'); setAmount('') }}>UNSTAKE</div>
          </div>

          <div className="field-lbl">
            <span>{mode === 'stake' ? 'AMOUNT TO STAKE' : 'AMOUNT TO UNSTAKE'}</span>
            <span className="bal-link" onClick={() => {
              if (!isConnected) return
              const b = balForMode
              setAmount(ethers.utils.formatUnits(b, contractsRef.current.tokenDecimals))
            }}>balance: {mode === 'stake' ? fmtTok(s.tokenBal) : fmtTok(s.myStake)} · MAX</span>
          </div>
          <div className="amount-row">
            <div className="amount-prefix">$GM</div>
            <input className="amount-input" type="number" min="0" step="any" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="quick-amts">
            {[0.25, 0.5, 0.75, 1].map(p => (
              <button key={p} className="qa" onClick={() => {
                if (!isConnected) return
                const b = balForMode
                setAmount(ethers.utils.formatUnits(b.mul(Math.round(p * 10000)).div(10000), contractsRef.current.tokenDecimals))
              }}>{p === 1 ? 'MAX' : (p * 100) + '%'}</button>
            ))}
          </div>

          {mode === 'stake' && (
            <div className="info-rows">
              <div className="info-row"><span className="info-lbl">YOU STAKE</span><span className="info-val">{amtBN ? fmtTok(amtBN) : '—'} {sym()}</span></div>
              <div className="info-row"><span className="info-lbl">NEW TOTAL POSITION</span><span className="info-val">{amtBN ? fmtTok(s.myStake.add(amtBN)) + ' ' + sym() : fmtTok(s.myStake) + ' ' + sym()}</span></div>
              <div className="info-row"><span className="info-lbl">PENALTY LOCK (re-arms to 100%)</span><span className="info-val warn">7 DAYS</span></div>
            </div>
          )}

          {mode === 'unstake' && (
            <div className="info-rows">
              <div className="info-row"><span className="info-lbl">YOU UNSTAKE</span><span className="info-val">{amtBN ? fmtTok(amtBN) : '—'} {sym()}</span></div>
              <div className="info-row"><span className="info-lbl">CURRENT PENALTY</span><span className="info-val warn">{others.lte(0) ? '0% (sole staker)' : penPct + '%'}</span></div>
              <div className="info-row"><span className="info-lbl">PENALTY FORFEIT → other stakers</span><span className="info-val warn">{fmtTok(effPen)} {sym()}</span></div>
              <div className="info-row"><span className="info-lbl">YOU RECEIVE</span><span className="info-val good">{amtBN ? fmtTok(out) : '—'} {sym()}</span></div>
            </div>
          )}

          <button className={btnClass} disabled={btnDisabled} onClick={btnDisabled ? undefined : doAction}>{btnText}</button>
          <div className="note">{mode === 'stake' ? 'Stake $GM to earn a share of every swap tax — paid in real ETH.' : 'You also collect any pending ETH + bonus tokens on unstake.'}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card">
            <div className="card-label"><span>YOUR REWARDS</span><span className="card-label-right">PAID IN ETH</span></div>
            {!isConnected ? (
              <div className="empty">
                <span className="big">— Ξ</span>
                connect your wallet to<br />view your staking position
              </div>
            ) : (
              <div>
                <div className="pos-big">{fmtEth(s.pendingEth, 5)}<span className="u">ETH</span></div>
                <div className="pos-sub">claimable now · streams over 24h (anti-JIT)</div>
                <button className="claim-btn" disabled={s.pendingEth.lte(0) && s.pendingTok.lte(0)} onClick={doClaim}>CLAIM ETH</button>
                <div className="info-rows" style={{ marginTop: '14px', marginBottom: '0' }}>
                  <div className="info-row"><span className="info-lbl">YOUR STAKE</span><span className="info-val">{fmtTok(s.myStake)} {sym()}</span></div>
                  <div className="info-row"><span className="info-lbl">POOL SHARE</span><span className="info-val">{share}%</span></div>
                  <div className="info-row"><span className="info-lbl">BONUS $GM (from penalties)</span><span className="info-val good">{fmtTok(s.pendingTok)} {sym()}</span></div>
                </div>
                <div className="penalty-box">
                  <div className="pen-top">
                    <div className="pen-lbl">EARLY-EXIT PENALTY</div>
                    <div className={'pen-val' + (penBpsDisplay > 0 ? ' hot' : ' cool')}>{penPct}%</div>
                  </div>
                  <div className="pen-track"><div className="pen-fill" style={{ width: (penBpsDisplay / 100) + '%' }}></div></div>
                  <div className="pen-note">
                    {penBpsDisplay > 0 && unlockAt > 0
                      ? penPct + '% penalty if you exit now · 0% in ' + Math.max(0, (unlockAt - Math.floor(Date.now() / 1000)) / 86400).toFixed(2) + ' days. Forfeit goes to loyal stakers.'
                      : 'No penalty — you can unstake your full position freely.'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="disc">
        <b>How it works.</b> Every swap on the $GM pool is taxed in ETH. 50% of that tax goes to the treasury (fuel for the gas-prediction app &amp; planned buybacks), 50% streams to stakers pro-rata in ETH over a 24h window. The tax starts at 20% while the cap is small to bootstrap the protocol and auto-tapers to 5% as marketcap grows. &nbsp;
        <b>Penalty.</b> Unstaking re-arms a 100% early-exit penalty that decays linearly to 0 over 7 days; whatever you forfeit is redistributed to the stakers who stay. &nbsp;
        <b>Non-custodial.</b> stake / unstake / claim are direct on-chain calls to the hook contract — no intermediary holds your funds.
      </div>

      <div className={'toast' + (toast.show ? ' show' : '') + (toast.kind ? ' ' + toast.kind : '')} dangerouslySetInnerHTML={{ __html: toast.msg }} />
    </div>
  )
}
