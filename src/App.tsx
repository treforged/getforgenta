import React, { Suspense } from 'react';
import { Route, Switch } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary'; // restored correct import path

const LazyComponentA = React.lazy(() => import('./components/ComponentA'));
const LazyComponentB = React.lazy(() => import('./components/ComponentB'));

const App = () => {
    return (
        <ErrorBoundary>
            <Suspense fallback={<div>Loading...</div>}>
                <Switch>
                    <Route path="/component-a" component={LazyComponentA} />
                    <Route path="/component-b" component={LazyComponentB} />
                </Switch>
            </Suspense>
        </ErrorBoundary>
    );
};

export default App;