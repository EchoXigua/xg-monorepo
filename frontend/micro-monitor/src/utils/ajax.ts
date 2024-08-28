import axios from 'axios';
import { XGRequest } from 'xg-request';

export const http = new XGRequest('/api', axios);
