import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MiniApp from './MiniApp';
import './styles/index.css';

const isMini = new URLSearchParams(window.location.search).get('mini') === '1';
const Root = isMini ? MiniApp : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
