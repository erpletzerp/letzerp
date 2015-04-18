from setuptools import setup, find_packages

version = "5.0.0-alpha"

with open("requirements.txt", "r") as f:
	install_requires = f.readlines()

setup(
    name='erpnext',
    version=version,
    description='Open Source ERP',
    # author='Web Notes Technologies',
    author='LetzERP',
    author_email='info@letzerp.com',
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires
)
