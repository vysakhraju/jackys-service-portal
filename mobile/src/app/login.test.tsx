import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useAuth } from '../context/AuthContext';
import LoginScreen from './login';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedUseAuth = useAuth as jest.Mock;

function setLogin(loginImpl: (email: string, password: string) => Promise<void>) {
  mockedUseAuth.mockReturnValue({ login: loginImpl });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LoginScreen', () => {
  it('shows a validation message rather than calling login when a field is empty', async () => {
    const login = jest.fn();
    setLogin(login);
    await render(<LoginScreen />);

    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(login).not.toHaveBeenCalled();
    expect(screen.getByTestId('login-error')).toHaveTextContent('Enter your email and password.');
  });

  it('calls login with the entered credentials on submit', async () => {
    const login = jest.fn().mockResolvedValue(undefined);
    setLogin(login);
    await render(<LoginScreen />);

    await fireEvent.changeText(screen.getByTestId('login-email'), 'amina@jackys.com');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secret123');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(login).toHaveBeenCalledWith('amina@jackys.com', 'secret123'));
    expect(screen.queryByTestId('login-error')).toBeNull();
  });

  it('shows "incorrect email or password" for a 401 response', async () => {
    const login = jest.fn().mockRejectedValue({ isAxiosError: true, response: { status: 401 } });
    setLogin(login);
    await render(<LoginScreen />);

    await fireEvent.changeText(screen.getByTestId('login-email'), 'amina@jackys.com');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'wrong');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent('Incorrect email or password.'));
  });

  it('shows an unreachable-server message for a network error (not a 401)', async () => {
    const login = jest.fn().mockRejectedValue(new Error('Network Error'));
    setLogin(login);
    await render(<LoginScreen />);

    await fireEvent.changeText(screen.getByTestId('login-email'), 'amina@jackys.com');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'secret123');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveTextContent('Could not reach the server', { exact: false }),
    );
  });
});
