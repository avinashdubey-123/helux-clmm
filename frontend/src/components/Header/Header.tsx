import './Header.css'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { NavLink } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import heluxLogo from '../../assets/helux-logo.svg'
import { useEffect, useRef } from 'react'
import { useTransactions } from '../../contexts/TxContext'

const ADMIN_ID = new PublicKey('wE2EtwuovRxvXZoThsXhRTuCrFdAA1jTbLnJp9nfezL')

export default function Header() {
  const { publicKey } = useWallet()
  const isAdmin = publicKey?.equals(ADMIN_ID)
  const { addTransaction } = useTransactions()
  const prevPublicKey = useRef(publicKey)

  useEffect(() => {
    if (publicKey && !prevPublicKey.current) {
      addTransaction(null, `Connected to ${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`, "Wallet Connected")
    }
    prevPublicKey.current = publicKey
  }, [publicKey, addTransaction])

  return (
    <header className="rcs-header">
        <NavLink to='/' className="rcs-logo">
          <img src={heluxLogo} />
        </NavLink>
        <nav className="rcs-nav">
          <NavLink to='/swap' className="rcs-nav__item">Swap</NavLink>
          <NavLink to='/' className="rcs-nav__item" end>Liquidity</NavLink>
          <NavLink to='/portfolio' className="rcs-nav__item">Portfolio</NavLink>
          {isAdmin && <NavLink to='/admin' className="rcs-nav__item">Admin</NavLink>}
        </nav>
        <div className="rcs-actions">
          <WalletMultiButton />
        </div>
    </header>
  )
}
