import type { LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData, Form } from '@remix-run/react';

export const loader = async ({ request }: LoaderFunctionArgs) => {

  return { message: 'You are logged in!' };
};

export default function DashboardRoute() {
  const { message } = useLoaderData<typeof loader>();

const foo = 'bar';

  return (
    <div>
      <h1>{message}</h1>
      <h2>Hello World {foo}</h2>
      <Form method='post' action='/logout'>
        <button type='submit'>Logout</button>
      </Form>
    </div>
  );
}
