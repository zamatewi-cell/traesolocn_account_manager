import { stringToColor, getInitials } from '../../lib/utils';

interface AccountAvatarProps {
  nickname: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  isActive?: boolean;
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
};

export function AccountAvatar({ nickname, avatarUrl, size = 'md', isActive }: AccountAvatarProps) {
  const initials = getInitials(nickname || '?');
  const bgColor = stringToColor(nickname || '?');
  const sizeClass = SIZE_CLASSES[size];

  return (
    <div className="relative">
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center font-semibold text-white overflow-hidden shadow-lg`}
        style={{
          background: avatarUrl ? undefined : `linear-gradient(135deg, ${bgColor}, ${bgColor}dd)`,
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={nickname}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to initials if image fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>
      
      {isActive && (
        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-bg-secondary flex items-center justify-center">
          <div className="w-1.5 h-1.5 bg-white rounded-full" />
        </div>
      )}
    </div>
  );
}
