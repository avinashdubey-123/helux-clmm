import Header from './components/Header/Header'
import { Routes, Route } from 'react-router-dom'
import Admin from './pages/Admin/Admin'
import CollectFees from './pages/Admin/CollectFees'
import Swap from './pages/Swap/Swap'
import Liquidity from './pages/Liquidity/Liquidity'
import Portfolio from './pages/Portfolio/Portfolio'
import InitializeForm from './pages/InitializeForm/InitializeForm'
import DepositForm from './pages/DepositForm/DepositForm'
import CreateFarm from './pages/CreateFarm/CreateFarm'
import { PoolsProvider } from './contexts/PoolsContext'
import { PositionsProvider } from './contexts/PositionsContext'

import { TxProvider } from './contexts/TxContext'

import { TokenRegistryProvider } from './contexts/TokenRegistryContext'
import About from './pages/About/About'
import { useLocation } from 'react-router-dom'

function App() {
  const location = useLocation()

  return (
    <TokenRegistryProvider>
      <TxProvider>
        <PoolsProvider>
          <PositionsProvider>
            {location.pathname !== '/' && <Header />}
            <main>
              <Routes>
                <Route path='/' element={<About />} />
                <Route path='/liquidity' element={<Liquidity />} />
                <Route path='/swap' element={<Swap />} />
                <Route path='/liquidity/create' element={<InitializeForm />} />
                <Route path='/liquidity/create-farm' element={<CreateFarm />} />
                <Route path='/liquidity/deposit' element={<DepositForm />} />
                <Route path='/portfolio' element={<Portfolio />} />
                <Route path='/admin' element={<Admin />} />
                <Route path='/admin/collect-fees' element={<CollectFees />} />
              </Routes>
            </main>
          </PositionsProvider>
        </PoolsProvider>
      </TxProvider>
    </TokenRegistryProvider>
  )
}

export default App
