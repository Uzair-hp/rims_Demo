import { createBrowserRouter } from 'react-router-dom'
import { routes } from './routes.jsx'

/** Browser router for the running app. Tests build the same `routes` in memory. */
export const router = createBrowserRouter(routes)
