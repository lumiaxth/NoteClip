import '@/panel/app.css';
import { mountPanel } from '@/panel/app';

document.documentElement.classList.add('nc-popup');
void mountPanel(document.getElementById('app')!);
