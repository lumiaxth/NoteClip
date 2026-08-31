import '@/panel/app.css';
import { mountPanel } from '@/panel/app';
import { initTheme } from '@/settings/theme';

document.documentElement.classList.add('nc-sidepanel');
void initTheme();
void mountPanel(document.getElementById('app')!);
