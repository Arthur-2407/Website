import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  FaGauge, 
  FaUserClock, 
  FaCalendar, 
  FaChartBar, 
  FaShield,
  FaUsers,
  FaBuilding,
  FaRightFromBracket
} from 'react-icons/fa6';
import { useAuth } from '@contexts/AuthContext';

interface NavItem {
  name: string;
  href: string;
  icon: any;
  roles?: string[];
}

const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const navigation: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: <FaGauge /> },
    { name: 'Attendance', href: '/attendance', icon: <FaUserClock /> },
    { name: 'Leave', href: '/leave', icon: <FaCalendar /> },
    { name: 'Reports', href: '/reports', icon: <FaChartBar /> },
    ...(user?.role === 'supervisor' || user?.role === 'admin' 
      ? [
          { name: 'Supervisor', href: '/supervisor', icon: <FaUsers /> },
        ] 
      : []),
    ...(user?.role === 'admin' 
      ? [
          { name: 'Admin', href: '/admin', icon: <FaBuilding /> },
          { name: 'Security', href: '/security', icon: <FaShield /> },
        ] 
      : []),
  ];

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      navigate('/login');
    }
  };

  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-blue-600">Attendance System</span>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`${
                    location.pathname === item.href
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium`}
                >
                  <span className="mr-2">{item.icon}</span>
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <button
                onClick={handleLogout}
                className="relative inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                <span className="mr-2">
                  <FaRightFromBracket />
                </span>
                Logout
              </button>
            </div>
            <div className="ml-3 relative">
              <div className="flex items-center">
                <div className="text-sm text-gray-700">
                  <span className="font-medium">
                    {user?.firstName} {user?.lastName}
                  </span>
                  <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {user?.role}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;