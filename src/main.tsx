import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { useEditor } from './store/store';
import { useUi } from './store/ui';

createRoot(document.getElementById('root')!).render(<App />);

// expose stores for end-to-end tests and debugging
(window as unknown as Record<string, unknown>).__editor = { useEditor, useUi };
