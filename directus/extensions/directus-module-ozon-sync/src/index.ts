import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './module.vue';

export default defineModule({
	id: 'ozon-sync',
	name: 'Ozon Sync',
	icon: 'sync',
	routes: [
		{
			path: '',
			component: ModuleComponent,
		},
	],
});
