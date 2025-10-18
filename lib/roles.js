const ROLES = {
    ADMIN: 1 << 0
};

function hasRole(userRole, role) {
    return (userRole & role) === role;
}

function addRole(userRole, role) {
    return userRole | role;
}

function removeRole(userRole, role) {
    return userRole & ~role;
}

module.exports = {
    ROLES,
    hasRole,
    addRole,
    removeRole
};
