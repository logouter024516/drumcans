import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Analyzer } from './pages/Analyzer';
import { History } from './pages/History';
import { Login } from './pages/Login';
import './App.css';

function App() {
  const rawBase = import.meta.env.BASE_URL || '/';
  const normalizedBase = rawBase.replace(/\/+$/, '') || '/';
  const routerBase = normalizedBase === '/' ? undefined : normalizedBase;
  return (
    <Router basename={routerBase}>
      <div className="app-container">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="*" element={<Analyzer />} />
            <Route path="/history" element={<History />} />
            <Route path="/login" element={<Login />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
