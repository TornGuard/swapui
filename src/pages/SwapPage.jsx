import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import { CONFIG, ZERO, ALCHEMY_RPC } from '../config'

const lc = a => String(a || '').toLowerCase()
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a) && a !== ZERO

const HOOK_ABI = [
  'function token() view returns (address)',
  'function currentTaxBps() view returns (uint256)',
  'function tradingEnabled() view returns (bool)',
  'function poolKey() view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))'
]
const UR_ABI = ['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']
const QUOTER_ABI = [
  'function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns (uint256 amountOut,uint256 gasEstimate)'
]
const PERMIT2_ABI = [
  'function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)',
  'function approve(address token,address spender,uint160 amount,uint48 expiration)'
]
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
]

const CMD_V4_SWAP = '0x10'
const ACTIONS_SWAP_SETTLE_TAKE = '0x060c0f'
const MAX_U160 = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffffffffffff')
const MAX_U48 = 281474976710655
const coder = ethers.utils.defaultAbiCoder
const MAXU = ethers.constants.MaxUint256

export default function SwapPage() {
  const { address, isConnected } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider('eip155')

  const [mode, setMode] = useState('buy')
  const [slipBps, setSlipBps] = useState(100)
  const [amount, setAmount] = useState('')
  const [toast, setToast] = useState({ msg: '', kind: '', show: false })
  const [busy, setBusy] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [spotCache, setSpotCache] = useState(0)
  const [quoteOut, setQuoteOut] = useState(ethers.constants.Zero)
  const [quoteIn, setQuoteIn] = useState(ethers.constants.Zero)

  const stRef = useRef({ walEth: ethers.constants.Zero, tokenBal: ethers.constants.Zero, taxBps: 0, p2Erc20: ethers.constants.Zero, p2Amt: ethers.constants.Zero, p2Exp: 0 })
  const contractsRef = useRef({ provider: null, signer: null, hook: null, ur: null, quoter: null, permit2: null, token: null, tokenAddr: null, tokenDecimals: 18, tokenSym: 'GM', poolKey: null, account: null })
  const quoteTimer = useRef(null)

  const short = a => a.slice(0, 6) + '..' + a.slice(-4)
  const sym = () => '$' + String(contractsRef.current.tokenSym).replace(/^\$/, '')
  const tk = () => String(contractsRef.current.tokenSym).replace(/^\$/, '')
  const nowSec = () => Math.floor(Date.now() / 1000)
  const keyTuple = () => {
    const pk = contractsRef.current.poolKey
    return [pk.currency0, pk.currency1, pk.fee, pk.tickSpacing, pk.hooks]
  }

  const showToast = useCallback((msg, kind = '') => {
    setToast({ msg, kind, show: true })
    setTimeout(() => setToast(s => ({ ...s, show: false })), kind === 'ok' ? 4000 : 3500)
  }, [])

  const errMsg = useCallback(e => {
    const m = e?.data?.message || e?.error?.message || e?.reason || e?.message || 'transaction failed'
    if (/user rejected|denied/i.test(m)) return 'Rejected in wallet'
    if (/NotLaunched/i.test(m)) return 'Trading not enabled yet on this pool'
    if (/TooLittleReceived|slippage/i.test(m)) return 'Slippage too tight — raise it and retry'
    return m.length > 90 ? m.slice(0, 90) + '…' : m
  }, [])

  const fmtEth = useCallback((bn, p = 5) => {
    try { return Number(ethers.utils.formatUnits(bn, 18)).toLocaleString(undefined, { maximumFractionDigits: p }) } catch { return '0' }
  }, [])

  const fmtTok = useCallback((bn, p = 2) => {
    try {
      const n = Number(ethers.utils.formatUnits(bn, contractsRef.current.tokenDecimals))
      if (n >= 1e6) return (n / 1e6).toFixed(3) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'
      return n.toLocaleString(undefined, { maximumFractionDigits: p })
    } catch { return '0' }
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
        } catch { showToast('Switch your wallet to chain ' + CONFIG.CHAIN_ID, 'err'); return }
      }
      const hook = new ethers.Contract(lc(CONFIG.HOOK), HOOK_ABI, signer)
      if ((await provider.getCode(lc(CONFIG.HOOK))) === '0x') { showToast('No contract at HOOK ' + short(CONFIG.HOOK), 'err'); return }
      const tokenAddr = await hook.token()
      const poolKey = await hook.poolKey()
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer)
      const tokenDecimals = await token.decimals().catch(() => 18)
      const tokenSym = await token.symbol().catch(() => 'GM')
      contractsRef.current = {
        provider, signer, hook,
        ur: new ethers.Contract(lc(CONFIG.UNIVERSAL_ROUTER), UR_ABI, signer),
        quoter: new ethers.Contract(lc(CONFIG.V4_QUOTER), QUOTER_ABI, provider),
        permit2: new ethers.Contract(lc(CONFIG.PERMIT2), PERMIT2_ABI, signer),
        token, tokenAddr, tokenDecimals, tokenSym, poolKey, account: address
      }
      refreshState()
      refreshSpot()
    } catch (e) { showToast(errMsg(e), 'err') }
  }, [walletProvider, address, showToast, errMsg])

  useEffect(() => {
    if (isConnected && walletProvider) initContracts()
    else { contractsRef.current = { provider: null, signer: null, hook: null, ur: null, quoter: null, permit2: null, token: null, tokenAddr: null, tokenDecimals: 18, tokenSym: 'GM', poolKey: null, account: null } }
  }, [isConnected, walletProvider, initContracts])

  const refreshState = useCallback(async () => {
    const c = contractsRef.current
    if (!c.hook || !c.account) return
    try {
      const [walEth, tokenBal, taxBps, p2Erc20, p2] = await Promise.all([
        c.provider.getBalance(c.account),
        c.token.balanceOf(c.account),
        c.hook.currentTaxBps().catch(() => ethers.BigNumber.from(2000)),
        c.token.allowance(c.account, lc(CONFIG.PERMIT2)),
        c.permit2.allowance(c.account, c.tokenAddr, lc(CONFIG.UNIVERSAL_ROUTER)),
      ]);
      (stRef.current = { walEth, tokenBal, taxBps: taxBps.toNumber(), p2Erc20, p2Amt: p2.amount, p2Exp: Number(p2.expiration) })
    } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    if (!isConnected) return
    const iv = setInterval(() => { if (!busy) { refreshState(); refreshSpot() } }, 15000)
    return () => clearInterval(iv)
  }, [isConnected, busy, refreshState])

  const refreshSpot = useCallback(async () => {
    const c = contractsRef.current
    if (!c.quoter || !c.poolKey) return
    try {
      const probe = ethers.utils.parseEther('0.01')
      const [out] = await c.quoter.callStatic.quoteExactInputSingle([keyTuple(), true, probe, '0x'])
      setSpotCache(Number(ethers.utils.formatUnits(out, c.tokenDecimals)) / 0.01)
    } catch { }
  }, [])

  const doQuote = useCallback(async () => {
    const c = contractsRef.current
    const raw = amount.trim()
    if (!isConnected || !c.quoter || !c.poolKey || !raw || isNaN(raw) || Number(raw) <= 0) {
      setQuoteOut(ethers.constants.Zero); setQuoteIn(ethers.constants.Zero); return
    }
    try {
      setQuoting(true)
      const dec = mode === 'buy' ? 18 : c.tokenDecimals
      const amt = ethers.utils.parseUnits(raw, dec)
      const zeroForOne = mode === 'buy'
      const [out] = await c.quoter.callStatic.quoteExactInputSingle([keyTuple(), zeroForOne, amt, '0x'])
      setQuoteIn(amt); setQuoteOut(out)
    } catch { setQuoteOut(ethers.constants.Zero); setQuoteIn(ethers.constants.Zero) }
    finally { setQuoting(false) }
  }, [amount, mode, isConnected])

  useEffect(() => {
    clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(doQuote, 280)
    return () => clearTimeout(quoteTimer.current)
  }, [amount, mode, doQuote])

  const minOut = useCallback(() => quoteOut.mul(10000 - slipBps).div(10000), [quoteOut, slipBps])

  const sellStep = useCallback(amt => {
    const s = stRef.current
    if (s.p2Erc20.lt(amt)) return 'erc20'
    if (s.p2Amt.lt(amt) || s.p2Exp <= nowSec()) return 'permit2'
    return 'swap'
  }, [])

  const parseIn = useCallback(() => {
    if (!amount.trim() || isNaN(amount) || Number(amount) <= 0) return null
    try {
      const dec = mode === 'buy' ? 18 : contractsRef.current.tokenDecimals
      return ethers.utils.parseUnits(amount.trim(), dec)
    } catch { return null }
  }, [amount, mode])

  const buildSwap = useCallback((zeroForOne, amountIn, minimumOut) => {
    const swapParams = coder.encode(
      ['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'],
      [[keyTuple(), zeroForOne, amountIn, minimumOut, '0x']]
    )
    const cIn = zeroForOne ? contractsRef.current.poolKey.currency0 : contractsRef.current.poolKey.currency1
    const cOut = zeroForOne ? contractsRef.current.poolKey.currency1 : contractsRef.current.poolKey.currency0
    const settle = coder.encode(['address', 'uint256'], [cIn, amountIn])
    const take = coder.encode(['address', 'uint256'], [cOut, minimumOut])
    const input = coder.encode(['bytes', 'bytes[]'], [ACTIONS_SWAP_SETTLE_TAKE, [swapParams, settle, take]])
    return { commands: CMD_V4_SWAP, inputs: [input] }
  }, [])

  const doAction = useCallback(async () => {
    if (busy || !isConnected) return
    const amt = parseIn()
    if (!amt) return
    const deadline = nowSec() + 1200
    try {
      setBusy(true)
      const c = contractsRef.current
      if (mode === 'sell') {
        const step = sellStep(amt)
        if (step === 'erc20') {
          showToast('Approving ' + sym() + ' to Permit2…')
          const tx = await c.token.approve(lc(CONFIG.PERMIT2), MAXU); await tx.wait()
          stRef.current.p2Erc20 = MAXU; showToast('Approved ✓', 'ok'); setBusy(false); return
        }
        if (step === 'permit2') {
          showToast('Enabling the router via Permit2…')
          const tx = await c.permit2.approve(c.tokenAddr, lc(CONFIG.UNIVERSAL_ROUTER), MAX_U160, MAX_U48); await tx.wait()
          stRef.current.p2Amt = MAX_U160; stRef.current.p2Exp = MAX_U48; showToast('Router enabled ✓', 'ok'); setBusy(false); return
        }
      }
      await doQuote()
      if (quoteOut.lte(0)) { showToast('No quote — pool may be illiquid', 'err'); setBusy(false); return }
      const mo = minOut()
      if (mode === 'buy') {
        const { commands, inputs } = buildSwap(true, amt, mo)
        showToast('Buying ' + sym() + '…')
        const tx = await c.ur.execute(commands, inputs, deadline, { value: amt }); await tx.wait()
        showToast('Bought ≈ ' + fmtTok(quoteOut) + ' ' + sym() + ' ✓', 'ok')
      } else {
        const { commands, inputs } = buildSwap(false, amt, mo)
        showToast('Selling ' + sym() + '…')
        const tx = await c.ur.execute(commands, inputs, deadline); await tx.wait()
        showToast('Sold for ≈ ' + fmtEth(quoteOut, 5) + ' ETH ✓', 'ok')
      }
      setAmount(''); setQuoteOut(ethers.constants.Zero); setQuoteIn(ethers.constants.Zero)
      refreshState(); refreshSpot()
    } catch (e) { showToast(errMsg(e), 'err') }
    finally { setBusy(false) }
  }, [busy, isConnected, mode, parseIn, sellStep, showToast, doQuote, quoteOut, minOut, buildSwap, fmtTok, sym, fmtEth, errMsg, refreshState, refreshSpot])

  const bal = mode === 'buy' ? stRef.current.walEth : stRef.current.tokenBal
  const amtBN = parseIn()
  const balStr = mode === 'buy' ? fmtEth(bal, 4) + ' ETH' : fmtTok(bal) + ' ' + sym()

  let btnText = 'CONNECT WALLET', btnDisabled = true, btnClass = 'act-btn up'
  if (isConnected) {
    btnClass = 'act-btn ' + (mode === 'buy' ? 'up' : 'down')
    if (!amtBN) { btnText = 'ENTER AMOUNT'; btnDisabled = true }
    else if (amtBN.gt(bal)) { btnText = 'INSUFFICIENT BALANCE'; btnDisabled = true }
    else if (quoting) { btnText = 'QUOTING…'; btnDisabled = true }
    else if (mode === 'buy') { btnText = 'BUY $' + tk(); btnDisabled = false }
    else {
      const step = sellStep(amtBN)
      if (step === 'erc20') { btnText = 'APPROVE $' + tk() + ' (1/2)'; btnDisabled = false }
      else if (step === 'permit2') { btnText = 'ENABLE ROUTER (2/2)'; btnDisabled = false }
      else { btnText = 'SELL $' + tk(); btnDisabled = false }
    }
  }

  const outVal = quoteOut.gt(0) ? (mode === 'buy' ? fmtTok(quoteOut) : fmtEth(quoteOut, 6)) : ''

  return (
    <div className="wrap">
      <div className="stat-strip">
        <div className="stat">
          <div className="stat-val">{isConnected && spotCache ? Math.round(spotCache).toLocaleString() : '—'}</div>
          <div className="stat-lbl">GM PER ETH</div>
        </div>
        <div className="stat">
          <div className="stat-val">{isConnected ? (stRef.current.taxBps / 100).toFixed(2) + '<span class="u">%</span>' : '—'}</div>
          <div className="stat-lbl">LIVE SWAP TAX</div>
        </div>
        <div className="stat">
          <div className="stat-val eth">{isConnected ? fmtTok(stRef.current.tokenBal) : '—'}</div>
          <div className="stat-lbl">YOUR $GM</div>
        </div>
      </div>

      <div className="card">
        <div className="seg">
          <div className={'seg-btn buy' + (mode === 'buy' ? ' active' : '')} onClick={() => { setMode('buy'); setAmount(''); setQuoteOut(ethers.constants.Zero) }}>BUY $GM</div>
          <div className={'seg-btn sell' + (mode === 'sell' ? ' active' : '')} onClick={() => { setMode('sell'); setAmount(''); setQuoteOut(ethers.constants.Zero) }}>SELL $GM</div>
        </div>

        <div className="field-lbl">
          <span>{mode === 'buy' ? 'YOU PAY' : 'YOU PAY'}</span>
          <span className="bal-link" onClick={() => {
            if (!isConnected) return
            const b = mode === 'buy' ? stRef.current.walEth : stRef.current.tokenBal
            let v = b
            if (mode === 'buy' && v.gt(ethers.utils.parseEther('0.01'))) v = v.sub(ethers.utils.parseEther('0.01'))
            setAmount(ethers.utils.formatUnits(v, mode === 'buy' ? 18 : contractsRef.current.tokenDecimals))
          }}>balance: {balStr} · MAX</span>
        </div>
        <div className="amount-row">
          <div className="amount-prefix">{mode === 'buy' ? 'ETH' : sym()}</div>
          <input className="amount-input" type="number" min="0" step="any" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="quick-amts">
          {[0.25, 0.5, 0.75, 1].map(p => (
            <button key={p} className="qa" onClick={() => {
              if (!isConnected) return
              const b = mode === 'buy' ? stRef.current.walEth : stRef.current.tokenBal
              let v = b.mul(Math.round(p * 10000)).div(10000)
              if (mode === 'buy' && p === 1 && v.gt(ethers.utils.parseEther('0.01'))) v = v.sub(ethers.utils.parseEther('0.01'))
              setAmount(ethers.utils.formatUnits(v, mode === 'buy' ? 18 : contractsRef.current.tokenDecimals))
            }}>{p === 1 ? 'MAX' : (p * 100) + '%'}</button>
          ))}
        </div>

        <div className="arrow">↓</div>

        <div className="field-lbl"><span>YOU RECEIVE (after tax)</span></div>
        <div className="amount-row out">
          <div className="amount-prefix">{mode === 'buy' ? sym() : 'ETH'}</div>
          <input className="amount-input" type="text" readOnly placeholder="0.00" value={outVal} />
        </div>

        <div className="info-rows">
          <div className="info-row">
            <span className="info-lbl">RATE</span>
            <span className="info-val dim">
              {quoteOut.gt(0) && quoteIn.gt(0)
                ? mode === 'buy'
                  ? '1 ETH ≈ ' + Math.round(Number(ethers.utils.formatUnits(quoteOut, contractsRef.current.tokenDecimals)) / Number(ethers.utils.formatUnits(quoteIn, 18))).toLocaleString() + ' ' + sym()
                  : '1 ' + sym() + ' ≈ ' + (Number(ethers.utils.formatUnits(quoteOut, 18)) / Number(ethers.utils.formatUnits(quoteIn, contractsRef.current.tokenDecimals))).toExponential(3) + ' ETH'
                : '—'}
            </span>
          </div>
          <div className="info-row">
            <span className="info-lbl">SWAP TAX (in this quote)</span>
            <span className="info-val warn">{isConnected ? (stRef.current.taxBps / 100).toFixed(2) + '% (ETH leg)' : '—'}</span>
          </div>
          <div className="info-row">
            <span className="info-lbl">MAX SLIPPAGE</span>
            <span className="slip">
              {[50, 100, 300].map(bps => (
                <button key={bps} className={'slip-btn' + (slipBps === bps ? ' active' : '')} onClick={() => setSlipBps(bps)}>{bps / 100 + '%'}</button>
              ))}
              <input className="slip-input" type="number" min="0" step="0.1" placeholder="…" onChange={e => {
                const v = parseFloat(e.target.value)
                if (!isNaN(v) && v >= 0) setSlipBps(Math.round(v * 100))
              }} />
            </span>
          </div>
          <div className="info-row">
            <span className="info-lbl">MIN RECEIVED</span>
            <span className="info-val">{quoteOut.gt(0) ? (mode === 'buy' ? fmtTok(minOut()) + ' ' + sym() : fmtEth(minOut(), 6) + ' ETH') : '—'}</span>
          </div>
        </div>

        <button className={btnClass} disabled={btnDisabled} onClick={btnDisabled ? undefined : doAction}>{btnText}</button>
        <div className="note">Routes through Uniswap's live Universal Router straight at the GM pool — no custom contract, no allowlist. The tax is already reflected in "you receive".</div>
      </div>

      <div className="disc">
        <b>No middle contract.</b> This page builds a Uniswap <b>v4</b> swap and sends it through the canonical, already-deployed <b>Universal Router</b> + <b>Permit2</b> — nothing custom is deployed. It targets the GM <b>PoolKey</b> directly, so the routing API's hook allowlist (the "no route" on app.uniswap.org) never applies. &nbsp;
        <b>Tax.</b> Every swap is taxed in ETH at the live taper rate; the quote shown is already net of it. &nbsp;
        <b>Sells</b> need a one-time Permit2 setup (token→Permit2, then Permit2→router). <b>Non-custodial</b> throughout.
      </div>

      <div className={'toast' + (toast.show ? ' show' : '') + (toast.kind ? ' ' + toast.kind : '')} dangerouslySetInnerHTML={{ __html: toast.msg }} />
    </div>
  )
}
