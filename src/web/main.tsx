import { createRoot } from 'react-dom/client';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/golos-text/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App';
import { refresh, startEvents } from './store';

createRoot(document.getElementById('root')!).render(<App />);
void refresh();
startEvents();
