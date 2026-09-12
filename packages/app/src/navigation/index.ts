// Route stacks. Not the navigator (SPEC §18 F3) — this holds no screens and
// renders nothing. It is the shape each cluster was already keeping by hand,
// named and given the one operation the hardware back needs: pop.
export {
    beneath,
    isOpen,
    isTop,
    rendered,
} from './routeStack';
export { useRouteStack } from './useRouteStack';
